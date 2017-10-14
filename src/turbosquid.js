const cheerio = require("cheerio");
const request = require("request").defaults({jar: true});
const util = require("util");
const fs = require("fs");
const unzip = require("unzip");

const DOMAIN = "https://www.turbosquid.com/";
const LOGIN_URL = DOMAIN + "Login/Index.cfm";
const SEARCH_URL = DOMAIN + "3d-model/%s?max_price=0&min_price=0";
const DOWNLOAD_URL = DOMAIN + "AssetManager/Index.cfm?stgAction=getFiles&subAction=Download&intID=%s&intType=3";
const FILE_URL = "https://storage9.turbosquid.com/Download/index.php?ID=%s_%s";

const allowedFormats = ["fbx", "stl", "obj", "3ds", "max", "ma"];

function ensureLoggedIn(cb) {
    if (!process.env.TURBOSQUID_USERNAME || !process.env.TURBOSQUID_PASSWORD)
        throw new Error("must set TURBOSQUID_USERNAME and TURBOSQUID_PASSWORD in env");

    request(LOGIN_URL, function(err, response, html) {
        if (err) throw err;

        const $ = cheerio.load(html);
        const formData = $("form#formLogin").serializeArray();

        const formInput = {};
        for (const {name, value} of formData)
            formInput[name] = value;
        formInput["LoginUsername"] = process.env.TURBOSQUID_USERNAME;
        formInput["LoginPassword"] = process.env.TURBOSQUID_PASSWORD;

        request.post({
            url: LOGIN_URL,
            form: formInput,
        }, function (err, response, body) {
            if (err) throw err;

            cb();
        });
    });
}

function searchFor(term) {
    ensureLoggedIn(function() {
        request(util.format(SEARCH_URL, term), function (err, response, html) {
            if (err) throw err;
            const $ = cheerio.load(html);
            const resultDivs = $("#SearchResultAssets > div");

            const randomResult = resultDivs[Math.floor(Math.random() * resultDivs.length)];
            const idStr = randomResult.attribs.id;
            if (idStr.substr(0, 5) !== "Asset")
                throw new Error("expected id to be AssetXXX");
            const id = parseInt(idStr.substr(5), 10);

            if (isNaN(id))
                throw new Error("expected a parsable int: " + idStr);

            console.log("randomly selected model id", id);

            request(util.format(DOWNLOAD_URL, id), function (err, response, html) {
                if (err) throw err;

                const productJSON = html.match(/purchasedProductFileJSON = (.*);/)[1];
                if (!productJSON)
                    throw new Error("expected purchasedProductFileJSON in result");

                const products = JSON.parse(productJSON);
                console.dir(products);

                for (const file of products.FILE_SYSTEM) {
                    if (file.PRODUCT_ID === id && file.ISMAINFILE === 1 && file.IS_FILE === 1)
                    {
                        if (allowedFormats.indexOf(file.SHORTFILEFORMAT) === -1)
                            continue;

                        const fileUrl = util.format(FILE_URL, id, file.FILEITEMID);
                        const name = file.NAME;

                        console.log(util.format("downloading %s (%s)", name, file.SIZE_KB));
                        request(fileUrl)
                            .on('error', function(err) { throw err; })
                            .pipe(fs.createWriteStream(name))
                            .on('finish', function() {
                                onFileDownloaded(name);
                            });

                        break;
                    }
                }
            });
        });
    });
}

function onFileDownloaded(name) {
    const dir = 'tmp';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    const nameLower = name.toLowerCase();
    if (nameLower.endsWith(".zip")) {
        console.log("unzipping", name);
        fs.createReadStream(name).pipe(unzip.Extract({path: dir}));
    }
}

if (require.main === module)
{
    const term = process.argv[2];
    if (!term)
    {
        console.error("usage: node turbosquid SEARCH_TERM");
        process.exit(1);
    }
    else
    {
        console.log("searching for", term);
        searchFor(term);
    }
}
    
