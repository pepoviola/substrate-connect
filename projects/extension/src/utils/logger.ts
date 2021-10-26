/**
 * Logger mechanism for extension
 *
 */

import { arrayExpression } from "@babel/types"

export enum LogLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
}

export enum Source {
  EXT_MSG_ROUTER,
}

const logAmount: number = 5

export function initLogger() {
  chrome.storage.local.get(["loggerPad"], (pad) => {
    console.log("initLogger")
    if (Object.keys(pad).length === 0) {
      console.log("initLogger not found - initializing")
      chrome.storage.local.set({ loggerPad: [] })
    } else {
      console.log("initLogger found")
    }
  })
}

export async function scLogger(
  lvl: LogLevel,
  src: Source,
  id: number,
  connChain: string,
  msg?: string,
  moreInfo?: object,
) {
  let logItem: string[]
  chrome.storage.local.get(["loggerPad"], (pad) => {
    logItem = [...pad.loggerPad] as string[]
    if (logItem.length >= logAmount - 1) {
      logItem.splice(0, logItem.length - (logAmount - 1))
    }
    const newLine = [
      Date.now(),
      lvl,
      src,
      id,
      connChain,
      msg || "-",
      JSON.stringify(moreInfo),
    ].join(", ")
    logItem.push(newLine)
    chrome.storage.local.set({ loggerPad: logItem })
  })
  chrome.storage.local.get(["loggerPad"], (pad) => {
    pad.loggerPad.forEach((p: string) => console.log(p.split(",")[0]))
  })
}
