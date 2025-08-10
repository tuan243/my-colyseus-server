const os = require("os");

/**
 * COLYSEUS CLOUD WARNING:
 * ----------------------
 * PLEASE DO NOT UPDATE THIS FILE MANUALLY AS IT MAY CAUSE DEPLOYMENT ISSUES
 */

module.exports = {
  apps: [
    {
      name: "colyseus-app",
      script: "build/index.js",
      time: true,
      watch: false,
      instances: os.cpus().length,
      exec_mode: "fork",
      wait_ready: true,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
  deploy: {
    production: {
      user: "deploy",
      host: ["192.168.1.101"],
      ref: "origin/main",
      repo: "git@github.com:tuan243/my-colyseus-server.git",
      path: "/home/deploy/my-colyseus-server",
      "post-deploy":
        "npm install && npm run build && npm run colyseus-post-deploy",
    },
  },
};

// module.exports = {
//   apps: [
//     {
//       name: 'ludo-server',
//       script: 'build/src/index.js',
//       time: true,
//       watch: false,
//       instances: os.cpus().length,
//       exec_mode: 'fork',
//       wait_ready: true,
//       env_production: {
//         NODE_ENV: 'production'
//       }
//     },
//     {
//       name: 'ludo-dev',
//       script: 'build/src/index.js',
//       time: true,
//       watch: false,
//       instances: os.cpus().length,
//       exec_mode: 'fork',
//       wait_ready: true,
//       env_development: {
//         NODE_ENV: 'development',
//         PORT: 2600
//       }
//     }
//   ],
//   deploy: {
//     staging: {
//       user: 'deploy',
//       host: ['192.168.1.101'],
//       ref: 'origin/test-pm2',
//       repo: 'git@github.com:tuan243/Ludo-server.git',
//       path: '/home/deploy/ludo-server',
//       'post-deploy': 'echo $PATH && npm install && npm run build && npm run colyseus-post-deploy'
//     },
//     production: {
//       user: 'root',
//       host: ['45.63.39.100'],
//       ref: 'origin/main',
//       repo: 'git@github.com:tuan243/Ludo-server.git',
//       path: '/home/deploy',
//       'post-deploy': 'npm install && npm run build && npm run colyseus-post-deploy'
//     },
//     miniapp: {
//       user: 'root',
//       host: ['61.14.233.213'],
//       ref: 'origin/main',
//       repo: 'git@github.com:tuan243/Ludo-server.git',
//       path: '/home/deploy',
//       'post-deploy': 'npm install && npm run build'
//     },
//     development: {
//       user: 'root',
//       host: ['61.14.233.213'],
//       ref: 'origin/dev',
//       repo: 'git@github.com:tuan243/Ludo-server.git',
//       path: '/home/deploy-dev',
//       'post-deploy': 'npm install && npm run build'
//     }
//   }
// };
