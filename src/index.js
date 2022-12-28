import fs from "fs";
import os from "os";
import http from "http";
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
import grabzit from "grabzit";


async function download(url, path) {
  const writer = fs.createWriteStream(path)
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })
  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })

};


// options:
// percentage [0-100] - image thumbnail percentage. Default = 10
// width [number] - image thumbnail width.
// height [number] - image thumbnail height.
// responseType ['buffer' || 'base64'] - response output type. Default = 'buffer'
// jpegOptions [0-100] - Example: { force:true, quality:100 }
// fit [string] - method by which the image should fit the width/height. Default = contain (details)
// failOnError [boolean] - Set to false to avoid read problems for images from some phones (i.e Samsung) in the sharp lib. Default = true (details)
// withMetaData [boolean] - Keep metadata in the thumbnail (will increase file size)

const waitForFile = async (filePath, timeout) => {
  timeout = timeout < 1000 ? 3000 : timeout
  try {
    var nom = 0
      return new Promise(resolve => {
        var inter = setInterval(() => {
          nom = nom + 100
          if (nom >= timeout) {
            clearInterval(inter)
            //maybe exists, but my time is up!
            resolve(false)
          }

          if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
            clearInterval(inter)
            //clear timer, even though there's still plenty of time left
            resolve(true)
          }
        }, 100)
      })
  } catch (error) {
    return false
  }
}


const videoThumbnail = (url, path) => download(url, path)
  // converter.convertToThumbnail(url)



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
    console.log(`image compression failed with error: ${e}`)
  }
}

const imgFromImagePath = async(source, w, h, q) => {
  console.log(`imgFromImagePath source = ${source}`)
  try {
    const imageBuffer = fs.readFile(source);
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
    console.log(`image compression failed with error: ${e?.message}`)
  }
}




const grabThumb = async (url, filename) => {
  // return new Promise(async(resolve, reject) => {
  //   var client = await new grabzit("NjBlN2Q5MzI2YTUwNDY1ZjgwYTdkYzc1YTk4Nzg1ZWQ=", "Pz8/P2d3P2c/Pz9TBj8/SAENJD8/Pz8gPz9KeE5zP3I=");
  //   var options = {"start":2, "duration":1, "framesPerSecond":1};
  //   await client.url_to_animation(url, options);
  //   //Then call the save or save_to method
  //   var randName = String(process.cwd())
  //     + url
  //     .replace("https://", "")
  //     .replace("http://", "")
  //     .replace("arweave.net/", "")
  //     .replace("/", "")
  //     .replace("=", "")
  //     .slice(0, 5)
  //     + ".gif";
  //   await client.save_to(`${randName}`, function (error, id){
  //       //this callback is called once the capture is downloaded
  //     return (randName)
  //       if (error != null){
  //           return(error)
  //       }
  //   });
  console.log(`url = ${url.replace("http://", "https://")}, filename = ${filename}`)
  const grabber = await new grabzit("NjBlN2Q5MzI2YTUwNDY1ZjgwYTdkYzc1YTk4Nzg1ZWQ=", "Pz8/P2d3P2c/Pz9TBj8/SAENJD8/Pz8gPz9KeE5zP3I=");
  await grabber.url_to_animation(url.replace("http://", "https://"), {"start":0, "duration":1, "framesPerSecond":1})
  await grabber.save_to(filename,  (error, id) => {
    if(error !== null) {
      console.log(error);
      return error
    }
    return filename
  })
}




const getFfmpeg = async (url, tmpDir, outStream) => {
  // try {
  console.log(url)
    const response = await ffmpeg(url)
    await response
      .format('mjpeg') // -f mjpeg
      .frames(1) // -vframes 1
      .size('320x320') // -s 320x240 : w = 320, h = 240
      .on('error', function(err) { console.log('An error occurred: ' + err.message); })
      .on('end', function() { console.log('Processing finished !'); })
    const action = await response.screenshots({
      count: 3,
      timemarks: ['0'],
      filename: "thumbnail",
      folder: "./",
      fastSeek: true
    })
    await action.pipe(outStream, { end: true })
    const fileExists = await waitForFile(`${tmpDir}/thumbnail.png`)
    if(fileExists) { return(true) }
    else { return (false)}
  // }
  // catch (e) {
  //   console.log(e)
  //   return (false)
  // }
}

const imgFromVideoUrl = async(url, w, h, q) => {
  try {
    let outStream = await fs.createWriteStream("video.mp4");
    const tmpDir = fs.mkdtempSync(appPrefix);
    console.log(tmpDir)
    const http_url = url.replace("https", "http");
    const res = await getFfmpeg(http_url, tmpDir, outStream);
    // const fileExists = await waitForFile(`${tmpDir}/thumbnail.png`, 3000)
    if(res) return (`${tmpDir}/thumbnail.png`)
    else return ("no file")
      // const ffmpeg1 = await ffmpeg(http_url); // got.stream(url))
      // const ffmpeg2 = await ffmpeg1.setFfmpegPath('/usr/bin/ffmpeg') // ffmpeg_static)
      //   .format('mjpeg')
      //   .frames(1)
      //   .size('320x320')
      //   // .on('start', function (commandLine) {
      //   //   console.log('COMMANDLINE =  ' + commandLine);
      //   // })
      // const ffmpeg3 = await ffmpeg2
      //   .on('error', function (err) {
      //     console.log('An error occurred: ' + err);
      //   })
      //   .on('end', function () {
      //     console.log('Processing finished !');
      //   })
      // const ffmpeg4 = await ffmpeg3
      //   .takeScreenshots({
      //     count: 2,
      //     timemarks: ['1'],
      //     filename: `thumbnail.png`,
      //   }, `${tmpDir}/`) // String(path.resolve(path.join(cwd, tmpDirName)))) //path.join(cwd, 'tmp'))//String(tmpDir))
      // ffmpeg4.pipe(outStream, {end: true});
      // return new Promise((resolve, reject) => {
      //   outStream.on('finish', resolve)
      //   outStream.on('error', reject)
      // })
    //   return null
    // }
    // await startFfmpeg()
    // return `${tmpDir}/thumbnail.png`
    // const start_ffmpeg = await startFfmpeg()
    // const data = await imgFromImagePath(`${tmpDir}/thumbnail.png`, w, h, q); //(cwd, 'tmp', "thumbnail.png"));//path.join(tmpDir, "thumbnail"));
    // return data
    // return "none"
  }
  catch (e) {  // handle error
    console.log(e)
    return null
  }
  finally {
    try {
      // if (tmpDir) {
      //   fs.rmSync(tmpDir, { recursive: true });
      // }
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


const getVideoScreenshot = async(url) => {
  console.log(`getvideoscreenshot url = ${url}`)
  const browser = await puppeteer
    .launch({
      // defaultViewport: {
      //   width: 500,
      //   height: 600,
      // },
      // args : [
      //   '--no-sandbox',
      //   '--disable-setuid-sandbox'
      // ],
      headless: true
    })
  const page = await browser.newPage();
  const pageHtml = `
  <html>
    <head>
      <meta name="viewport" content="width=device-width">
      <link rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&amp;display=swap">
  </head>
  <body>
  <video autoplay="" name="media" autoPlay
         src=${url}
         type="video/mp4"></video>
  </body>
  </html>
  `
  // const pageHtml = `
  //   <html lang="en">
  //     <body>
  //       <video id="vid" autoplay preload="auto">
  //         <source src=${url} type="video/mp4" >
  //       </video>
  //     </body>
  //   </html>`
  await page.setContent(pageHtml, {waitUntil: 'networkidle0'});
  const content = await page.$("body");
  const imageBuffer = await content.screenshot({ omitBackground: false });
  await page.close();
  await browser.close();
  return imageBuffer;
}


const appCache = new nodecache({ stdTTL : 3599});

// var app = express(queue({ activeLimit: 2, queuedLimit: -1 }));
const app = express();
app.use(express.json())
app.use(express.urlencoded({ extended: true }));


app.get('/favicon.ico', async(req,res) => {
  return res.send("404")
})

app.get('/test', async(req,res) => {
  // fs.readFile('ar-minimizer-cacheVilx7t/thumbnail.png', function(err, data) {
  //   if (err) throw err // Fail if the file can't be read.
  //   res.writeHead(200, {'Content-Type': 'image/jpeg'})
  //   res.end(data) // Send the file data to the browser.
  // })
  let url = idToUrl(req.query?.url)
  if (!fs.existsSync("tmp")) {
    fs.mkdirSync("tmp");
  }

  let browser = null;

  try {
    // launch headless Chromium browser
    browser = await puppeteer.launch({ headless: true });

    // create new page object
    const page = await browser.newPage();
    // set viewport width and height
    await page.setViewport({ width: 1440, height: 1080 });
    await page.goto(url);

    // capture screenshot and store it into screenshots directory.
    await page.screenshot({ path: `tmp/github-profile.jpeg` });
    fs.readFile('tmp/github-profile.jpeg', function(err, data) {
      if (err) throw err // Fail if the file can't be read.
      res.writeHead(200, {'Content-Type': 'image/jpeg'})
      res.end(data) // Send the file data to the browser.
    })
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log(`\n🎉 GitHub profile screenshots captured.`);
  }
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

app.get('/video', async(req,res) => {
  let url = idToUrl(req.query?.url);
  url = url.replace("https", "http");
  console.log(url);
  if (false && appCache.has(url)) {
    console.log('Get data from Node Cache');
    const data = await appCache.get(url);
    return res.json({image: data});
  } 
  else {
    const contentType = await getContentType(url);
    const mimeType = contentType.split("/")?.slice(0, 1)[0];
    if(mimeType !== "video") return res.json({image: null, error: "source is not a video"})
    try {
      const filename = "" // String(process.cwd())
        + url
        .replace("https://", "")
        .replace("http://", "")
        .replace("arweave.net/", "")
        .replace("/", "")
        .replace("=", "")
        .slice(0, 5)
        + ".gif"
      const output = await grabThumb(url, filename);
      const fileExists = await waitForFile(filename);
      console.log(output);
      // if(!output) return;
      await fs.readFile(String(filename), function(err, data) {
        if (err) throw err // Fail if the file can't be read.
        res.writeHead(200, {'Content-Type': 'image/gif'})
        res.end(data) // Send the file data to the browser.
      })
    }
    catch (e) {
      console.log(e)
      res.end("none")
    }

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

app.get('/', async(req,res) => {
  return res.send("Enter a /txId to get the base64 thumbnail...")
})

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
