const videoQualities = ['144', '240', '360', '720', '1080', '1440', '4k'];
const audioQualities = ['mp3', 'm4a', 'webm', 'aacc', 'flac', 'apus', 'ogg', 'wav'];

async function processDownload(videoUrl, mediaType, quality = null) {
const apiKey = 'dfcb6d76f2f6a9894gjkege8a4ab232222';
const isAudio = audioQualities.includes(mediaType);
const format = isAudio ? mediaType : quality;

const initUrl = `https://p.savenow.to/ajax/download.php?copyright=0&format=${format}&url=${encodeURIComponent(videoUrl)}&api=${apiKey}`;

const headers = {
'User-Agent': 'Mozilla/5.0 (Android 13; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0',
'Referer': 'https://y2down.cc/enSB/'
};

try {
const response = await fetch(initUrl, { headers });
const data = await response.json();

if (!data.success) {
throw new Error('Init failed');
}

const taskId = data.id;
const progressUrl = `https://p.savenow.to/api/progress?id=${taskId}`;

let progress = 0;
let downloadUrl = null;

while (progress < 1000) {
await new Promise(resolve => setTimeout(resolve, 2000));

const progressResponse = await fetch(progressUrl, { headers });
const progressData = await progressResponse.json();

progress = progressData.progress;

if (progress === 1000 && progressData.download_url) {
downloadUrl = progressData.download_url;
break;
}
}

if (downloadUrl) {
return downloadUrl;
} else {
throw new Error('No download URL');
}

} catch (error) {
throw error;
}
}

async function yt2dow_cc(videoUrl, options = {}) {
const { quality = '720', format = 'mp3', type = 'video' } = options;

if (type === 'video') {
if (!videoQualities.includes(quality)) {
throw new Error(`Invalid quality: ${quality}`);
}
return processDownload(videoUrl, 'video', quality);
} else {
if (!audioQualities.includes(format)) {
throw new Error(`Invalid format: ${format}`);
}
return processDownload(videoUrl, format);
}
}

module.exports = yt2dow_cc;