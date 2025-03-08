// Javascript: main.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');

const app = express();
// Configurar Express para confiar en el proxy de Render
app.set('trust proxy', true);

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

// Puerto por defecto 10000
const PORT = process.env.PORT || 10000;

const pdfFolder = path.join(__dirname, 'pdfs');
const coversFolder = path.join(__dirname, 'covers');

// Crear la carpeta de portadas si no existe
if (!fs.existsSync(coversFolder)) {
  fs.mkdirSync(coversFolder);
}

// Función recursiva para obtener los PDFs y su categoría según la estructura de carpetas
function getPdfFiles(baseDir, relativePath = '') {
  const currentPath = path.join(baseDir, relativePath);
  let pdfFiles = [];
  const items = fs.readdirSync(currentPath);
  items.forEach(item => {
    const itemPath = path.join(currentPath, item);
    const stats = fs.statSync(itemPath);
    if (stats.isDirectory()) {
      pdfFiles = pdfFiles.concat(getPdfFiles(baseDir, path.join(relativePath, item)));
    } else if (stats.isFile() && path.extname(item).toLowerCase() === '.pdf') {
      pdfFiles.push({
        name: item,
        category: relativePath || 'general',
        fullPath: itemPath,
        relativePdfPath: path.join(relativePath, item)
      });
    }
  });
  return pdfFiles;
}

// Función para generar la portada de un PDF usando pdftoppm y redimensionarla a 200px de ancho
function generateCover(pdfPath, coverFullPath) {
  return new Promise((resolve, reject) => {
    // Aseguramos que exista la carpeta destino
    const coverDir = path.dirname(coverFullPath);
    if (!fs.existsSync(coverDir)) {
      fs.mkdirSync(coverDir, { recursive: true });
    }
    // Eliminamos la extensión para usar -singlefile y obtener directamente outputBase.jpg
    const outputBase = coverFullPath.slice(0, -4);
    // Se genera la portada con pdftoppm (ajustando la calidad) y luego se redimensiona con ImageMagick
    const cmd = `pdftoppm -jpeg -jpegopt quality=30 -singlefile -f 1 -l 1 "${pdfPath}" "${outputBase}" && convert "${coverFullPath}" -resize 200 "${coverFullPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('Error generando portada para:', pdfPath, error);
        return reject(error);
      }
      if (fs.existsSync(coverFullPath)) {
        resolve();
      } else {
        reject(new Error("No se generó la portada en " + coverFullPath));
      }
    });
  });
}

// Procesa todos los PDFs y genera las portadas si aún no existen
async function processPdfs() {
  const pdfFiles = getPdfFiles(pdfFolder);
  for (const pdf of pdfFiles) {
    const baseName = path.basename(pdf.name, '.pdf');
    const coverRelPath = path.join(pdf.category, baseName + '.jpg');
    const coverFullPath = path.join(coversFolder, coverRelPath);
    // Se asigna la ruta relativa de la portada al objeto
    pdf.coverRelative = coverRelPath;
    if (!fs.existsSync(coverFullPath)) {
      try {
        console.log(`Generando portada para: ${pdf.relativePdfPath}`);
        await generateCover(pdf.fullPath, coverFullPath);
      } catch (err) {
        console.error('Error generando portada para:', pdf.relativePdfPath, err);
      }
    }
  }
}

// Middleware para servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Endpoint API que devuelve la lista de PDFs con sus detalles
app.get('/api/pdfs', (req, res) => {
  const pdfFiles = getPdfFiles(pdfFolder);
  const pdfList = pdfFiles.map(pdf => {
    const stats = fs.statSync(pdf.fullPath);
    const baseName = path.basename(pdf.name, '.pdf');
    const coverRelPath = path.join(pdf.category, baseName + '.jpg');
    return {
      name: pdf.name,
      category: pdf.category,
      size: stats.size,
      cover: '/covers/' + coverRelPath,
      pdf: '/pdfs/' + pdf.relativePdfPath
    };
  });
  res.json(pdfList);
});

// Servir archivos estáticos: public, pdfs y covers
app.use(express.static('public'));

// Middleware para registrar descargas en la ruta /pdfs
app.use('/pdfs', (req, res, next) => {
  console.log(`📂DESCARGA: ${decodeURIComponent(req.path)}`);
  next();
}, express.static(pdfFolder));

app.use('/covers', express.static(coversFolder));

// Variables para contar usuarios conectados
let connectedUsers = 0;

// Configuración de Socket.io para registrar conexiones y desconexiones
io.on('connection', (socket) => {
  // Obtener la IP del cliente
  let clientIp = socket.handshake.address;
  if (socket.handshake.headers['x-forwarded-for']) {
    clientIp = socket.handshake.headers['x-forwarded-for'].split(',')[0].trim();
  }

  connectedUsers++;
  console.log(`🟢${connectedUsers}|+Usr[${clientIp}]`);

  socket.on('disconnect', () => {
    connectedUsers--;
    console.log(`🔴${connectedUsers}|-Usr[${clientIp}]`);
  });
});

// Procesamos los PDFs y luego iniciamos el servidor
processPdfs().then(() => {
  server.listen(PORT, () => {
    console.log(`Servidor iniciado en el puerto ${PORT}`);
  });
}).catch(err => {
  console.error('Error procesando PDFs:', err);
});