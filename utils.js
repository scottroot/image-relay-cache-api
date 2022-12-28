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

const waitForFile = async (filePath, timeout) => {
  timeout = timeout < 1000 ? 1000 : timeout
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
    console.log(`image compression failed with error: ${e?.message}`)
  }
}


const imgFromVideoUrl = async(url, w, h, q) => {
  try {
    // let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
    let cwd = process.cwd();
    // console.log(String(tmpDir));
    var outStream = await fs.createWriteStream('video.mp4');
    // let stream = await axios.get(url, { responseType: 'stream' });
    // let tmpDir = await fs.mkdtempSync(appPrefix);
    // let tmpDir = path.join(cwd, fs.mkdtempSync(appPrefix));
    let tmpDirName = fs.mkdtempSync(appPrefix);
    let tmpDir = path.join(process.cwd(), tmpDirName);
    const startFfmpeg = async() => {
      await ffmpeg(url.replace("https", "http")) // got.stream(url))
        .setFfmpegPath('/usr/bin/ffmpeg') // ffmpeg_static)
        .format('mjpeg')
        .frames(1)
        .size('320x320')
        // .on('start', function (commandLine) {
        //   console.log('COMMANDLINE =  ' + commandLine);
        // })
        .on('error', function (err) {
          console.log('An error occurred: ' + err);
        })
        .on('end', function () {
          console.log('Processing finished !');
        })
        .takeScreenshots({
          count: 2,
          timemarks: ['1'],
          filename: `${tmpDirName}/thumbnail.png`,
        }, "") // String(path.resolve(path.join(cwd, tmpDirName)))) //path.join(cwd, 'tmp'))//String(tmpDir))
        .pipe(outStream, {end: true});
      await waitForFile(`${tmpDirName}/thumbnail.png`)
      return null
    }
    const start_ffmpeg = await startFfmpeg()
    const data = await imgFromImagePath(`${tmpDirName}/thumbnail.png`, w, h, q); //(cwd, 'tmp', "thumbnail.png"));//path.join(tmpDir, "thumbnail"));
    return data
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