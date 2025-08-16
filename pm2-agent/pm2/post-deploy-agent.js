/**
 * PM2 Agent for no downtime deployments on Colyseus Cloud.
 *
 * How it works:
 * - New process(es) are spawned (MAX_ACTIVE_PROCESSES/2)
 * - NGINX configuration is updated so new traffic only goes through the new process
 * - Old processes are asynchronously and gracefully stopped.
 * - The rest of the processes are spawned/reactivated.
 */
const pm2 = require("pm2");
const fs = require("fs");
const cst = require("pm2/constants");
// const io = require('@pm2/io');
const path = require("path");
const shared = require("./shared");

// --------- CLI args ----------
if (!process.argv[2] || !process.argv[2].includes(":")) {
  console.error(
    "Usage: post-deploy-agent.js <cwd>:<ecosystemFilePath>\n" +
      "Example: post-deploy-agent.js /var/www/app:/var/www/app/ecosystem.config.js"
  );
  process.exit(1);
}
const [cwd, ecosystemFilePath] = process.argv[2].split(":");

// --------- Options / state ----------
const opts = { env: process.env.NODE_ENV || "production" };
let config = undefined;

const CONFIG_FILE = [
  "ecosystem.config.cjs",
  "ecosystem.config.js",
  "pm2.config.cjs",
  "pm2.config.js",
].find((filename) => fs.existsSync(path.resolve(pm2.cwd, filename)));

if (!CONFIG_FILE) {
  throw new Error(
    'missing ecosystem config file. make sure to provide one with a valid "script" entrypoint file path.'
  );
}

const CONFIG_FILE_PATH = `${pm2.cwd}/${CONFIG_FILE}`;
const arg = `${pm2.cwd}:${CONFIG_FILE_PATH}`;

pm2.connect(async function (err) {
  if (err) {
    console.error(err.stack || err);
    console.log("Post-deploy failed");
    process.exit();
  }

  try {
    config = await shared.getAppConfig(ecosystemFilePath);
    opts.cwd = cwd;
    postDeploy(cwd, onReply);
  } catch (err) {
    onReply({ success: false, message: err?.message });
  }
});

// --------- "reply" equivalent for our standalone agent ----------
let replied = false;
function onReply(data) {
  if (replied) return;
  replied = true;

  if (data?.success === false) {
    console.error(
      data?.message ||
        "Post-deploy failed. Check application logs for more details."
    );
    console.log("Post-deploy failed");
    // IMPORTANT: do NOT exit here; allow logs/cleanup to continue if any.
    return;
  }

  console.log("Post-deploy success"); // <-- caller (post-deploy.js) listens for this and exits
  // Agent continues running to finish the rolling restart and NGINX updates.
}

const restartingAppIds = new Set();

function postDeploy(cwd, reply) {
  shared.listApps(function (err, apps) {
    if (err) {
      console.error(err);
      return reply({ success: false, message: err?.message });
    }

    // first deploy, start all processes
    if (apps.length === 0) {
      return pm2.start(config, { ...opts }, (err, result) => {
        reply({ success: !err, message: err?.message });
        updateAndSave(err, result);
      });
    }

    //
    // detect if cwd has changed, and restart PM2 if it has
    //
    if (apps[0].pm2_env.pm_cwd !== cwd) {
      console.log(
        "App Root Directory changed. Restarting may take a bit longer..."
      );

      //
      // remove all and start again with new cwd
      //
      return pm2.delete("all", function (err) {
        logIfError(err);

        // start again
        pm2.start(config, { ...opts }, (err, result) => {
          reply({ success: !err, message: err?.message });
          updateAndSave(err, result);
        });
      });
    }

    /**
     * Graceful restart logic:
     * List of PM2 app envs to stop or restart
     */
    const appsToStop = [];
    const appsStopped = [];
    let numAppsStopping = 0;
    let numTotalApps = undefined;

    apps.forEach((app) => {
      const env = app.pm2_env;

      /**
       * Asynchronously teardown/stop processes with active connections
       */
      if (env.status === cst.STOPPED_STATUS) {
        appsStopped.push(env);
      } else if (env.status !== cst.STOPPING_STATUS) {
        appsToStop.push(env);
      } else if (!restartingAppIds.has(env.pm_id)) {
        numAppsStopping++;
      }
    });

    /**
     * - Start new process
     * - Update NGINX config to expose only the new process
     * - Stop old processes
     * - Spawn/reactivate the rest of the processes (shared.MAX_ACTIVE_PROCESSES)
     */
    const onFirstAppsStart = async (initialApps, err, result) => {
      /**
       * release post-deploy action while proceeding with graceful restart of other processes
       */
      reply({ success: !err, message: err?.message });

      if (err) {
        return console.error(err);
      }

      let numActiveApps = initialApps.length + restartingAppIds.size;
      /**
       * - Write NGINX config to expose only the new active process
       * - The old ones processes will go down asynchronously (or will be restarted)
       */
      writeNginxConfig(initialApps);

      //
      // Wait 1.5 seconds to ensure NGINX is updated & reloaded
      //
      await new Promise((resolve) => setTimeout(resolve, 1500));

      //
      // Asynchronously stop/restart apps with active connections
      // (They make take from minutes up to hours to stop)
      //
      appsToStop.forEach((app_env) => {
        if (numActiveApps < shared.MAX_ACTIVE_PROCESSES) {
          numActiveApps++;

          restartingAppIds.add(app_env.pm_id);
          pm2.restart(app_env.pm_id, (err, _) => {
            restartingAppIds.delete(app_env.pm_id);
            if (err) {
              return logIfError(err);
            }

            // reset counter stats (restart_time=0)
            pm2.reset(app_env.pm_id, logIfError);
          });
        } else {
          pm2.stop(app_env.pm_id, logIfError);
        }
      });

      if (numActiveApps < shared.MAX_ACTIVE_PROCESSES) {
        const missingOnlineApps = shared.MAX_ACTIVE_PROCESSES - numActiveApps;

        pm2.scale(
          apps[0].name,
          numTotalApps + missingOnlineApps,
          updateAndSaveIfAllRunning
        );
      }
    };

    const numHalfMaxActiveProcesses = Math.ceil(
      shared.MAX_ACTIVE_PROCESSES / 2
    );

    /**
     * Re-use previously stopped apps if available
     */
    if (appsStopped.length >= numHalfMaxActiveProcesses) {
      const initialApps = appsStopped.splice(0, numHalfMaxActiveProcesses);

      let numSucceeded = 0;
      initialApps.forEach((app_env) => {
        // console.log("pm2.restart => ", app_env.pm_id);

        restartingAppIds.add(app_env.pm_id);
        pm2.restart(app_env.pm_id, (err) => {
          restartingAppIds.delete(app_env.pm_id);
          if (err) {
            return replyIfError(err, reply);
          }

          // reset counter stats (restart_time=0)
          pm2.reset(app_env.pm_id, logIfError);

          // TODO: set timeout here to exit if some processes are not restarting

          numSucceeded++;
          if (numSucceeded === initialApps.length) {
            onFirstAppsStart(initialApps);
          }
        });
      });
    } else {
      /**
       * Increment to +(MAX/2) processes
       */
      let LAST_NODE_APP_INSTANCE =
        apps[apps.length - 1].pm2_env.NODE_APP_INSTANCE;
      const initialApps = Array.from({ length: numHalfMaxActiveProcesses }).map(
        (_, i) => {
          const new_app_env = Object.assign({}, apps[0].pm2_env);
          new_app_env.NODE_APP_INSTANCE = ++LAST_NODE_APP_INSTANCE;
          return new_app_env;
        }
      );

      numTotalApps = apps.length + numHalfMaxActiveProcesses;

      // Ensure to scale to a number of processes where `numHalfMaxActiveProcesses` can start immediately.
      pm2.scale(
        apps[0].name,
        numTotalApps,
        onFirstAppsStart.bind(undefined, initialApps)
      );
    }
  });
}

function updateAndSave() {
  // console.log("updateAndExit");
  updateAndReloadNginx(() => complete());
}

function updateAndSaveIfAllRunning(err) {
  if (err) {
    return console.error(err);
  }

  updateAndReloadNginx((app_envs) => {
    if (app_envs.length === shared.MAX_ACTIVE_PROCESSES) {
      complete();
    }
  });
}

function updateAndReloadNginx(cb) {
  //
  // If you are self-hosting and reading this file, consider using the
  // following in your self-hosted environment:
  //
  // #!/bin/bash
  // # Requires fswatch (`apt install fswatch`)
  // # Reload NGINX when colyseus_servers.conf changes
  // fswatch /etc/nginx/colyseus_servers.conf -m poll_monitor --event=Updated | while read event
  // do
  //     service nginx reload
  // done
  shared.listApps(function (err, apps) {
    if (apps.length === 0) {
      err = "no apps running.";
    }
    if (err) {
      return console.error(err);
    }

    const app_envs = apps
      .filter(
        (app) =>
          app.pm2_env.status !== cst.STOPPING_STATUS &&
          app.pm2_env.status !== cst.STOPPED_STATUS
      )
      .map((app) => app.pm2_env);

    writeNginxConfig(app_envs);

    cb?.(app_envs);
  });
}

function writeNginxConfig(app_envs) {
  // console.log("writeNginxConfig: ", app_envs.map(app_env => app_env.NODE_APP_INSTANCE));

  const port = 2567;
  const addresses = [];

  app_envs.forEach(function (app_env) {
    addresses.push(`127.0.0.1:${port + app_env.NODE_APP_INSTANCE}`);
  });

  // write NGINX config
  fs.writeFileSync(
    shared.NGINX_SERVERS_CONFIG_FILE,
    addresses.map((address) => `server ${address};`).join("\n"),
    logIfError
  );
}

function complete() {
  // "pm2 save" then exit cleanly
  pm2.dump((err) => {
    logIfError(err);
    try { pm2.disconnect(); } catch (_) {}
    process.exit(0);
  });
}

function logIfError(err) {
  if (err) {
    console.error(err);
  }
}

function replyIfError(err, reply) {
  if (err) {
    console.error(err);
    reply({ success: false, message: err?.message });
  }
}
