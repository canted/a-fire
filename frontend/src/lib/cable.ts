import { io } from "socket.io-client";
import { createCable } from "./createCable";
import { apiBaseUrl, client } from "./api";

export const cable = createCable({
  getAccessToken: () => client.getAccessToken(),
  createSocket: (auth) =>
    io(new URL(apiBaseUrl).origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      auth,
    }),
});
