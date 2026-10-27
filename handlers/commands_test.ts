import type { MyContext } from "../bot.ts";
import { handleHelpCommand } from "./commands.ts";

Deno.test("help uses plain text and releases its operation state", async () => {
  let text = "";
  let options: unknown;
  const ctx = {
    session: { isOperationInProgress: false },
    reply: (message: string, settings?: unknown) => {
      text = message;
      options = settings;
      return Promise.resolve();
    },
  };
  await handleHelpCommand(ctx as unknown as MyContext);
  if (!text.includes("/setfav USD") || !text.includes("/cancel") || options !== undefined || ctx.session.isOperationInProgress) {
    throw new Error("Help is incomplete or requires Telegram markup parsing");
  }
});
