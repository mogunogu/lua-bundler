const fs = require("fs")
const path = require("path")
const readline = require("readline")
const luamin = require("luamin")
const logger = require("./logger")

const codeHeader = `
local __modules = {}
local require = function(path)
    local module = __modules[path]
    if module ~= nil then
        if not module.inited then
            module.cached = module.loader()
            module.inited = true
        end
        return module.cached
    else
        error("module not found")
        return nil
    end
end
`

const startMark = "--nef-inject"
const endMark = "--nef-inject-end"

const regex = new RegExp(/^(?!--)(.*require)[ \t]*\(?["']([a-zA-Z0-9\/\._]+)["']\)?(.*)$/gm)
let workDir = "."
/**
 * @type {{[key: string] : boolean}}
 */
let requireList = {}
let outStr
// const used = []
// const unused = []

/**
 * @param {fs.PathLike} mainPath
 */
function recurseFiles(name) {
    if (requireList[name]) {
        return
    }
    const fpath = path.join(workDir, name + ".lua")
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) {
        logger.error(`File not found ${fpath}`)
        return
    }
    const newNames = []
    const file = fs.readFileSync(fpath).toString().replace(regex, (m, p1, p2, p3) => {
        return `${p1}("${p2.replace(/\./g, "/")}")${p3}`
    })
    outStr += `\n----------------\n`
    outStr += `__modules["${name}"] = { inited = false, cached = false, loader = function(...)`
    outStr += `\n---- START ${name}.lua ----\n`
    outStr += file
    outStr += `\n---- END ${name}.lua ----\n`
    outStr += ` end}`
    requireList[name] = true
    // requires
    let match
    do {
        match = regex.exec(file)
        if (match !== null) {
            if (requireList[match[2]] === undefined) {
                requireList[match[2]] = false
                newNames.push(match[2])
            }
        }
    } while (match !== null)
    for (let i = 0; i < newNames.length; i++) {
        recurseFiles(newNames[i])
    }
}

function findUnusedFiles(dir, list, dirbase) {
    if (dirbase === undefined) {
        dirbase = ""
    } else {
        dirbase = dirbase + "/"
    }
    const files = fs.readdirSync(dir)
    for (const file of files) {
        const full = path.join(dir, file)
        const st = fs.statSync(full)
        if (st.isFile()) {
            if (file.endsWith(".lua")) {
                const base = path.basename(full, ".lua")
                const key = dirbase + base
                if (requireList[key] === undefined) {
                    list.push(key)
                }
                //  else {
                //     used.push(key)
                // }
            }
        } else if (st.isDirectory()) {
            findUnusedFiles(full, list, dirbase + path.basename(file))
        } else {
            logger.error("WTF is " + full)
        }
    }
}

/**
 * @param {fs.PathLike} mainPath
 * @returns {string}
 */
function emitCode(mainPath) {
    if (!fs.existsSync(mainPath) || !fs.statSync(mainPath).isFile()) {
        logger.error(`File not found ${mainPath}`)
        return ""
    }
    workDir = path.dirname(mainPath)
    outStr = codeHeader
    const mainName = path.basename(mainPath, ".lua")
    recurseFiles(mainName)
    const unused = []
    findUnusedFiles(workDir, unused)
    
    logger.warn("Unused files : " + unused.length + " 개")
    return outStr + `\n__modules["${mainName}"].loader()`
}

function injectWC3(mainPath, wc3path, mode) {
    if (!fs.existsSync(wc3path) || !fs.statSync(wc3path).isFile()) {
        logger.error(`File not found ${wc3path}`)
        return
    }
    let file = emitCode(mainPath)
    if (mode === "-p") {
        file = luamin.minify(file)
    }
    file = file.replace(/'(....)'/gm, (a, b) => {
        const v1 = b.charCodeAt(0) << 24
        const v2 = b.charCodeAt(1) << 16
        const v3 = b.charCodeAt(2) << 8
        const v4 = b.charCodeAt(3)
        return "(" + (v1 | v2 | v3 | v4) + ")"
    })
    const ri = readline.createInterface({
        input: fs.createReadStream(wc3path),
    })
    let state = 0
    let outFile = ""
    let changed = false
    ri.on("line", function (line) {
        if (line.trim() === endMark) {
            outFile += file + "\n"
            state = 0
        }
        if (state === 2) {
            return
        }
        if (state === 0 && line === "function main()") {
            state = 1
            changed = true
        }
        if (state === 1 && line === "end") {
            outFile += startMark + "\n"
            outFile += file + "\n"
            outFile += endMark + "\n"
            state = 0
        }
        if (line.trim() === startMark) {
            state = 2
            changed = true
        }
        outFile += line + "\n"
    })
    ri.on("close", function () {
        fs.writeFileSync(wc3path, outFile)
        requireList = {}
        if (changed) {
            logger.success("Write to war3map.lua success")
        } else {
            logger.error("Target file is not war3map.lua")
        }
    })
}

function toFile(mainPath, outPath, mode) {
    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
        logger.error(`Target is dir ${outPath}`)
        return
    }
    let file = emitCode(mainPath)
    if (mode === "-p") {
        file = luamin.minify(file)
    }
    fs.writeFileSync(outPath, file)
    logger.success(`Write to ${outPath} success`)
    requireList = {}
}

// function status(mainPath) {
//     var res = []
//     res.used = used
//     res.unused = unused
//     findUnusedFiles(res)
//     return res
// }

module.exports = {
    injectWC3,
    toFile,
    // status
}
