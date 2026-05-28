import { $ } from "bun"
import { iconChannel, resolveChannel, type Channel } from "./utils"

const arg = process.argv[2]
const channel: Channel = arg === "dev" || arg === "beta" || arg === "prod" || arg === "dogfood" ? arg : resolveChannel()

const src = `./icons/${iconChannel(channel)}`
const dest = "resources/icons"

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
