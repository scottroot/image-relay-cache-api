import fs from "fs";
// import { fileTypeFromStream } from 'file-type';
import imageThumbnail from 'image-thumbnail';
import express from "express";
import nodecache from 'node-cache';
import ffmpeg from "fluent-ffmpeg";
import ffmpeg_static from "ffmpeg-static";
import axios from "axios";
import puppeteer from "puppeteer";
import queue from "express-queue";


const getContentType = (url) => (
  axios.get(url)
    .then((res) => res.headers["content-type"])
    .then((val) => String(val).split(";")[0]
));

const getPageScreenshot = (url) => puppeteer
    .launch({
      defaultViewport: {
        width: 500,
        height: 600,
      },
      args : [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    })
    .then(async (browser) => {
      const page = await browser.newPage();
      await page.goto(url, {waitUntil: 'networkidle0'});
      const data = await page.screenshot({encoding: 'base64'});
      await browser.close();
      return data
    })
;

const appCache = new nodecache({ stdTTL : 3599});

var app = express(queue({ activeLimit: 2, queuedLimit: -1 }));
app.use(express.json())
app.use(express.urlencoded({ extended: true }));

app.get('/', async(req,res) => {
  return res.send("Enter a /txId to get the base64 thumbnail...")
})
app.get('/favicon.ico', async(req,res) => {
  return res.send("404")
})

app.get('/page/:id', async(req,res) => {
  const id = req.params.id;
  let url = id;
  if (id.length === 43) {
    url = `https://arweave.net/${id}`;
  }
  return res.send(await getPageScreenshot(url));
})

app.get('/:id', async(req,res) => {
  try {
    const id = req.params.id;
    // if(!id || id.length !== 43) return res.send("incorrect id format");
    if (appCache.has(`${id}`)) {
      console.log('Get data from Node Cache');
      const data = appCache.get(`${id}`);
      return res.send(data);
    } else {
      let url = id;
      if (id.length === 43) {
        url = `https://arweave.net/${id}`;
      }
      if (!url.startsWith("http")) {
        url = `https://${url}`;
      }

      const contentType = await getContentType(url);
      const mimeType = contentType.split("/")?.slice(0, 1)[0];
      try {
        if (mimeType === "video" || contentType === "image/gif") {
          let rname = (Math.random() + 1).toString(36).substring(7);
          var outStream = fs.createWriteStream('video.mp4');
          await ffmpeg(url)
            .setFfmpegPath(ffmpeg_static)
            .format('mjpeg')
            .frames(1)
            .size('320x320')
            .on('error', function (err) {
              console.log('An error occurred: ' + err.message);
            })
            .on('end', function () {
              console.log('Processing finished !');
            })
            .takeScreenshots({
              count: 1,
              timemarks: ['5'],
              filename: `thumbnail${rname}.png`
            }, 'tmp')
            .pipe(outStream, {end: true});
          var bitmap = await fs.readFileSync("tmp/thumbnail.png");
          var img64 = new Buffer.from(bitmap, "binary").toString('base64');
          const data = `data:image/png;base64,${img64}`;
          appCache.set(`${id}`, data);
          return res.json({image: data});
        }
        if (contentType === "text/html") {
          const screenshot64 = await getPageScreenshot(url);
          console.log(screenshot64);
          const data = `data:image/png;base64,${screenshot64}`;
          appCache.set(`${id}`, data);
          return res.json({image: data});
        } else {
          const thumbnail = await imageThumbnail({uri: url}, {width: 320, height: 320});
          const img64 = thumbnail.toString('base64');
          const data = `data:image/png;base64,${img64}`;
          appCache.set(`${id}`, data);
          return res.json(data);
        }
      } catch (err) {
        console.log(err.message)
      }
    }
    return res.json({image: null});
  } catch (err) {
    return res.json({image: null, error: err})
  }
})

// app.get('/stats',(req,res)=>{
//   res.send(appCache.getStats());
// })

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
