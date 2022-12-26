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
import cors from "cors";


// options:
// percentage [0-100] - image thumbnail percentage. Default = 10
// width [number] - image thumbnail width.
// height [number] - image thumbnail height.
// responseType ['buffer' || 'base64'] - response output type. Default = 'buffer'
// jpegOptions [0-100] - Example: { force:true, quality:100 }
// fit [string] - method by which the image should fit the width/height. Default = contain (details)
// failOnError [boolean] - Set to false to avoid read problems for images from some phones (i.e Samsung) in the sharp lib. Default = true (details)
// withMetaData [boolean] - Keep metadata in the thumbnail (will increase file size)

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
  


app.get('/page', cors(), async(req, res) => {
  let url = req.query?.url;
  if (appCache.has(`${url}`)) {
      console.log('Get data from Node Cache');
      const data = appCache.get(`${url}`);
      return res.json(data);
  } else {
    try { 
      
      const screenshot64 = await getPageScreenshot(url);
      // console.log(screenshot64);
      const data = `data:image/png;base64,${screenshot64}`;
      appCache.set(`${url}`, data);
      return res.json(data);
    } catch (err) {
      const data = err;
      res.json(data)
    }
  }
})


// app.get('/image/:id', async(req,res) => {
app.get('/image', cors(), async(req,res) => {
  try { 
  // const id = req.params.id;
  // console.log(`api tx param = ${id}`);
      let url = req.query?.url;
      const width = req.query?.width || 320;
      const height = req.query?.height || 320;
      if (appCache.has(`${url}`)) {
        console.log('Get data from Node Cache');
        const data = appCache.get(`${url}`);
        return res.json(data);
      } else {
        if (url.length === 43) {
          url = `https://arweave.net/${url}`; 
        } 
        if (!url.startsWith("http")) {
          url = `https://${url}`;
        }
        let options;
        if(width && height) {
          options = {responseType: 'base64', fit: 'cover', withMetaData: true, width: Number(width), height: Number(height)}
        }
        else {
          options = {responseType: 'base64', fit: 'cover', withMetaData: true, percentage: 50}
        }
         
        const thumbnail = await imageThumbnail({uri: url}, options);
        // const img64 = thumbnail.toString('base64');
        const data = `data:image/png;base64,${thumbnail}`;
        appCache.set(`${url}`, data);
        return res.json(data);
      }  
  } catch (err) {
    return res.json({image: null, error: err})
  }
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
              filename: `thumbnail${rname}.png`,
              qscale: 7
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
          return res.json({image: data});
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


app.get('/video/:id', async(req,res) => {
  const curr_working_dir = process.cwd();
  console.log(curr_working_dir);
  const id = req.params.id;
  console.log(id);
  if (appCache.has(`${id}`)) {
    console.log('Get data from Node Cache');
    const data = await appCache.get(`${id}`);
    return res.json({image: data});
  } 
  else {
    try {
      let url = id;
      if (id.length === 43) url = `https://arweave.net/${id}`
      if (!url.startsWith("http")) url = `https://${url}`

      const contentType = await getContentType(url);
      const mimeType = contentType.split("/")?.slice(0, 1)[0];
      console.log(mimeType);

      // let rname = (Math.random() + 1).toString(36).substring(7);
      try {
        // if (mimeType === "video" || contentType === "image/gif") {
        
        var outStream = await fs.createWriteStream('video.mp4');
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
            timemarks: ['1'],
            filename: `${id}.png`
          }, 'tmp')
          .pipe(outStream, {end: true});
      }
      catch (err) {
        console.log(err.message)
      }

      try {
        var bitmap = await fs.readFileSync(`${id}.png`);
        var img64 = await new Buffer.from(bitmap, "binary").toString('base64');
        const data = `data:image/png;base64,${img64}`;
        appCache.set(`${id}`, data);
        // return res.json({image: data});
        return res.send(data);
        // }
      }
      catch (err) {
        console.log(err)
      }
      
      try {
        var bitmap = await fs.readFileSync(`${curr_working_dir}/${id}.png`);
        var img64 = await new Buffer.from(bitmap, "binary").toString('base64');
        const data = `data:image/png;base64,${img64}`;
        appCache.set(`${id}`, data);
        // return res.json({image: data});
        return res.send(data);
        // }
      }
      catch (err) {
        console.log(err)
      }
      return res.json({image: null});
    } catch (err) {
      return res.json({image: null, error: err})
    }
  }
})

// app.get('/stats',(req,res)=>{
//   res.send(appCache.getStats());
// })

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
