module.exports = {
    success: function (...params) {
        console.log("\u001b[32m✔", ...params,"\u001b[0m")
    },
    log: console.log,
    warn: function (...params) {
        //업데이트 확인용
        console.log("\u001b[31m⚠\u001b[0m", ...params)
    },
    error: function (...params) {
        console.log("❌", ...params)
    },
}
