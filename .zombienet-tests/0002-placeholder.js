const { connectParachain } = require("./utils")

async function run(nodeName, networkInfo) {
  console.log(networkInfo)
  const api = await connectParachain(nodeName, networkInfo)
  let count = 0
  await new Promise(async (resolve, reject) => {
    const unsub = await api.rpc.chain.subscribeNewHeads((header) => {
      if (++count === 2) {
        unsub()
        resolve()
      }
    })
  })
  return count
}

module.exports = { run }
