import { fileTypeFromBuffer } from 'file-type';
import got from 'got';
import fs from "fs";
import { fileTypeFromStream } from 'file-type';
import imageThumbnail from 'image-thumbnail';
import express from "express";
import nodecache from 'node-cache';
import ffmpeg from "fluent-ffmpeg";
import ffmpeg_static from "ffmpeg-static";


const appCache = new nodecache({ stdTTL : 3599});
var app = express();
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const port = 3000;


app.get('/:id', async(req,res) => {
  const id = req.params.id;

  if(appCache.has(`${id}`)){
    console.log('Get data from Node Cache');
    const data = appCache.get(`${id}`);
    return res.send(data);
  }
  else {
    const url = `https://arweave.net/${id}`;
    console.log(`Url = ${url}`);
    const stream = got.stream(url);
    const dataType = await fileTypeFromStream(stream)
    const mimeType = dataType.mime.split("/")[0];

    if(mimeType === "video") {
      console.log('Fetch data from video API');
      var outStream = fs.createWriteStream('video.mp4');
      await ffmpeg(url)
        .setFfmpegPath(ffmpeg_static)
        .format('mjpeg')
        .frames(1)
        .size('320x240')
        .on('error', function(err) {
          console.log('An error occurred: ' + err.message);
        })
        .on('end', function() {
          console.log('Processing finished !');
        })
        .takeScreenshots({
            count: 1,
            timemarks: [ '0' ],
            filename: "thumbnail.png"
          }, 'tmp')
        .pipe(outStream, { end: true });
      var bitmap = await fs.readFileSync("tmp/thumbnail.png");
      var img64 = new Buffer.from(bitmap, "binary").toString('base64');
      const data = `data:image/png;base64,${img64}`;
      appCache.set(`${id}`,data);
      return res.send(`${data}`);
    }
    else {
      try {
        console.log('Fetch data from image API');
        const data = await imageThumbnail({ uri: url });
        appCache.set(`${id}`,data);
        return res.send(data);
      }
      catch (err) {
        console.error(err);
      }
    }
  }
  return res.send("none");
});

// app.get('/stats',(req,res)=>{
//   res.send(appCache.getStats());
// })

app.listen(port, () => {
  console.log("Server running on port 3000");
});
