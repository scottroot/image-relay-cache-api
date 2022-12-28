import fs from "fs";
import os from "os";
import path from "path";
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
import got from "got"
import sharp from "sharp";
import sizeOf from "image-size";

// options:
// percentage [0-100] - image thumbnail percentage. Default = 10
// width [number] - image thumbnail width.
// height [number] - image thumbnail height.
// responseType ['buffer' || 'base64'] - response output type. Default = 'buffer'
// jpegOptions [0-100] - Example: { force:true, quality:100 }
// fit [string] - method by which the image should fit the width/height. Default = contain (details)
// failOnError [boolean] - Set to false to avoid read problems for images from some phones (i.e Samsung) in the sharp lib. Default = true (details)
// withMetaData [boolean] - Keep metadata in the thumbnail (will increase file size)

let tmpDir;
const appPrefix = 'ar-minimizer-cache';
// try {
//   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
//   // the rest of your app goes here
// }
// catch (e) {  // handle error
//   console.log(err)
// }
// finally {
//   try {
//     if (tmpDir) {
//       fs.rmSync(tmpDir, { recursive: true });
//     }
//   }
//   catch (e) {
//     console.error(`An error has occurred while removing the temp folder at ${tmpDir}. Please remove it manually. Error: ${e}`);
//   }
// }

const imgFromImageUrl = async(url, w, h, q) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');
    const width = w || 50;
    const height = h || 50;
    const quality = q || 25;
    const dimensions = getDimensions(imageBuffer, 10, { width, height });
    let jpegOptions
    if(width && height) {
        jpegOptions = {width: Number(width), height: Number(height), quality: quality} // percentage: 50, 
      }
      else {
        jpegOptions = {quality: quality} // percentage: 50, 
      }
    const fit = "cover"
    const failOnError = true;
    const withMetaData = true;
    const thumbnailBuffer = await sharpResize(imageBuffer, dimensions, jpegOptions, fit, failOnError, withMetaData);
    const image64 = thumbnailBuffer.toString('base64');

    return image64
  }
  catch (e) {
    console.log(`image compression failed with error: ${e.message}`)
  }
}

const imgFromImagePath = async(source, w, h, q) => {
  try {
    const imageBuffer = fs.readFileSync(source);
    const width = w || 50;
    const height = h || 50;
    const quality = q || 25;
    const dimensions = getDimensions(imageBuffer, 10, { width, height });
    let jpegOptions
    if(width && height) {
        jpegOptions = {width: Number(width), height: Number(height), quality: quality} // percentage: 50, 
      }
      else {
        jpegOptions = {quality: quality} // percentage: 50, 
      }
    const fit = "cover"
    const failOnError = true;
    const withMetaData = true;
    const thumbnailBuffer = await sharpResize(imageBuffer, dimensions, jpegOptions, fit, failOnError, withMetaData);
    const image64 = thumbnailBuffer.toString('base64');

    return image64
  }
  catch (e) {
    console.log(`image compression failed with error: ${e.message}`)
  }
}


const imgFromVideoUrl = async(source, w, h, q) => {
  try {
    let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
    // let cwd = process.cwd();
    // console.log(String(tmpDir));
    var outStream = await fs.createWriteStream('video.mp4');
    // let stream = await axios.get(url, { responseType: 'stream' });
    await ffmpeg({source: url.replace("https", "http")}) // got.stream(url))
      .setFfmpegPath(ffmpeg_static)
      .format('mjpeg')
      .frames(1)
      .size('320x320')
      .on('start', function(commandLine) {
        console.log('COMMANDLINE =  ' + commandLine);
      })
      .on('error', function (err) {
        console.log('An error occurred: ' + err);
      })
      .on('end', function () {
        console.log('Processing finished !');
      })
      .takeScreenshots({
        count: 2,
        timemarks: ['1'],
        filename: `thumbnail`,
        // qscale: 7,
      }, tmpDir) //path.join(cwd, 'tmp'))//String(tmpDir))
      .pipe(outStream, {end: true});
    const data = await imgFromImagePath(path.join(tmpDir, "thumbnail.png"), w, h, q); //(cwd, 'tmp', "thumbnail.png"));//path.join(tmpDir, "thumbnail"));
    return data
  }
  catch (e) {  // handle error
    console.log(e)
    return null
  }
  finally {
    try {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    }
    catch (e) {
      console.error(`An error has occurred while removing the temp folder at ${tmpDir}. Please remove it manually. Error: ${e}`);
    }
  }
}
const idToUrl = (id) => {
  console.log(id);
  if(!id) return;
  let url = id;
  if (id.length === 43 && !url.startsWith("http")) {
    url = `https://arweave.net/${id}`
  }
  if (id.startsWith("ar://")) {
    url = id.replace("ar://", "https://arweave.net/")
  }
  if (id.startsWith("ipfs://")) {
    url = id.replace("ipfs://", "https://ipfs.io/ipfs/")
  }
  if (!url.startsWith("http")) {
    url = `https://${url}`
  }

  return url
}


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



const getDimensions = (imageBuffer, percentageOfImage, dimensions) => {
    if (typeof dimensions.width != 'undefined' || typeof dimensions.height != 'undefined') {
        return removeUndefined(dimensions);
    }

    const originalDimensions = sizeOf(imageBuffer);

    const width = parseInt((originalDimensions.width * (percentageOfImage / 100)).toFixed(0));
    const height = parseInt((originalDimensions.height * (percentageOfImage / 100)).toFixed(0));

    return { width, height };
}

const removeUndefined = (dimensions) => {
    Object.keys(dimensions).forEach(key => dimensions[key] === undefined && delete dimensions[key]);
    return dimensions
}

const sharpResize = (imageBuffer, dimensions, jpegOptions, fit, failOnError, withMetadata) => {
    return new Promise((resolve, reject) => {
        let result = sharp(imageBuffer, { failOnError })
            .resize({
                ...dimensions, withoutEnlargement: true, fit: fit ? fit : 'contain',
            })

            if(withMetadata){
              result.withMetadata()
            }

            result.jpeg(jpegOptions ? jpegOptions : { force: false })
            .toBuffer((err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
    });
};

app.get('/image', cors(), async(req,res) => {
  let url = idToUrl(req.query?.url);
  if (appCache.has(url)) {
    console.log('Get data from Node Cache');
    const data = appCache.get(url);
    return res.json(data);
  } else {
    try { 
      const data = await imgFromImageUrl(url, req.query?.width, req.query?.height, req.query?.quality)

      appCache.set(`${req.query}`, data);
      return res.send(data);

    } catch (err) {
      console.log(err)
      return res.json({image: null, error: err})
    }
  }
}) 





//////////////////////////////////////////////////
// VIDEO
//////////////////////////////////////////////////

// app.get('/video/:id', async(req,res) => {
  // let url = idToUrl(req.params?.id);
app.get('/video', async(req,res) => {
  let url = idToUrl(req.query?.url);
  url = url.replace("https", "http");
  console.log(url);
  if (appCache.has(url)) {
    console.log('Get data from Node Cache');
    const data = await appCache.get(url);
    return res.json({image: data});
  } 
  else {
    const contentType = await getContentType(url);
    const mimeType = contentType.split("/")?.slice(0, 1)[0];
    if(mimeType !== "video") return res.json({image: null, error: "source is not a video"})

    const data = imgFromVideoUrl(url);
    if(data) {
      appCache.set(url, data);
    }
    return res.json({image: null, error: e})
  }
})

app.get('/stats',(req,res)=>{
  res.send(appCache.getStats());
})


app.get('/:id', async(req,res) => {
  let url = idToUrl(req.params?.id);
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
      console.log(`mime type = ${mimeType}`);
      try {
        if (mimeType === "video" || contentType === "image/gif") {
          const curr_working_dir = process.cwd();
          const rname = (Math.random() + 1).toString(36).substring(7);
          const thumb_name = `thumbnail-${id.replace("/","").replace("=","").slice(0,4)}`
          console.log(`thumbnail file name = ${thumb_name}`);
          var outStream = fs.createWriteStream('video.mp4');
          var mediaStream = await got.stream(url);
          await ffmpeg(mediaStream)
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
              filename: thumb_name,
              qscale: 7
            }, `${curr_working_dir}/tmp`)
            .pipe(outStream, {end: true});
          var bitmap = await fs.readFileSync(`${curr_working_dir}/tmp/${thumb_name}`);
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


app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
