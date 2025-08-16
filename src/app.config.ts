import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import config from "@colyseus/tools";

/**
 * Import your Room files
 */
import { RedisDriver, RedisPresence, matchMaker } from "colyseus";
import { MyRoom } from "./rooms/MyRoom";

import("@pm2/io")
  .then((io) => {
    io.default.metric({
      id: "app/stats/ccu",
      name: "CCU",
      value: () => matchMaker.stats.local.ccu
    });

    io.default.metric({
      id: "app/stats/roomcount",
      name: "Room Count",
      value: () => matchMaker.stats.local.roomCount
    });
  })
  .catch(() => {
    console.log('no pm2 io');
  });

export default config({
    options: {
        driver: new RedisDriver(),
        presence: new RedisPresence(),

        publicAddress: `nginx.tuan-server-01.name.vn/${(Number(process.env.PORT) + Number(process.env.NODE_APP_INSTANCE))}`
    },

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        console.log('port', process.env.PORT, process.env.NODE_APP_INSTANCE);
        gameServer.define('my_room', MyRoom);

    },

    initializeExpress: (app) => {
        /**
         * Bind your custom express routes here:
         * Read more: https://expressjs.com/en/starter/basic-routing.html
         */
        app.get("/hello_world", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
         */
        app.use("/monitor", monitor());
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});
