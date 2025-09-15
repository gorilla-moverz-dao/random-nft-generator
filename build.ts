const {
  ArtEngine,
  inputs,
  generators,
  renderers,
  exporters,
} = require("@hashlips-lab/art-engine");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
import config from "./config";


const BASE_PATH = __dirname;

const ASSETS_SRC = `${BASE_PATH}/data`;
const ASSETS_SORTED = `${BASE_PATH}/data_sorted`;

function getZIndex(dirName: string): number {
  const m = dirName.match(/_z(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function ensureDirClean(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  fs.mkdirSync(p, { recursive: true });
}

async function prepareAssets(maxW: number, maxH: number) {
  console.log(`\n🧹 Preparing assets in ${ASSETS_SORTED} (sorted by _zN and resized to fit ${maxW}x${maxH})`);
  ensureDirClean(ASSETS_SORTED);

  const entries = fs.readdirSync(ASSETS_SRC, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => {
        const za = getZIndex(a);
        const zb = getZIndex(b);
        if (za !== zb) return za - zb; // small z goes first (bottom)
        return a.localeCompare(b);
      });

  // Copy folders in the sorted order, and downscale any oversize PNGs to avoid sharp composite error
  for (let i = 0; i < entries.length; i++) {
    const srcDir = path.join(ASSETS_SRC, entries[i]);
    // prefix to stabilize alpha sort but keep original folder name visible
    const idx = String(i).padStart(3, '0');
    const dstDir = path.join(ASSETS_SORTED, `${idx}__${entries[i]}`);
    fs.mkdirSync(dstDir, { recursive: true });

    const stack = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const f of stack) {
      const src = path.join(srcDir, f.name);
      const dst = path.join(dstDir, f.name);
      if (f.isDirectory()) {
        // shallow copy subfolders if someone groups variants
        fs.mkdirSync(dst, { recursive: true });
        for (const s of fs.readdirSync(src, { withFileTypes: true })) {
          const sSrc = path.join(src, s.name);
          const sDst = path.join(dst, s.name);
          if (s.isFile() && s.name.toLowerCase().endsWith('.png')) {
            await downscaleIfNeeded(sSrc, sDst, maxW, maxH);
          } else if (s.isFile()) {
            fs.copyFileSync(sSrc, sDst);
          }
        }
      } else if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
        await downscaleIfNeeded(src, dst, maxW, maxH);
      } else if (f.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }
}

async function downscaleIfNeeded(src: string, dst: string, maxW: number, maxH: number) {
  try {
    const meta = await sharp(src).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > maxW || h > maxH) {
      await sharp(src)
          .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true })
          .png()
          .toFile(dst);
      console.log(`⬇️  ${path.relative(BASE_PATH, src)}  ${w}x${h} -> fit inside ${maxW}x${maxH}`);
    } else {
      // copy as-is if already within bounds
      fs.copyFileSync(src, dst);
    }
  } catch (e) {
    console.error(`⚠️  Failed to probe/copy ${src}:`, (e as Error).message);
    // best-effort copy
    try { fs.copyFileSync(src, dst); } catch {}
  }
}

const ae = new ArtEngine({
  cachePath: `${BASE_PATH}/cache`,
  outputPath: `${BASE_PATH}/output`,
  useCache: false,

  inputs: {
    // Define the input plugin (ImageLayersInput) to load image layers
    ruff: new inputs.ImageLayersInput({
      assetsBasePath: `${BASE_PATH}/data_sorted`,
    }),
  },

  generators: [
    // Define the generator plugin (ImageLayersAttributesGenerator) to generate attributes for each item
    new generators.ImageLayersAttributesGenerator({
      dataSet: "ruff",
      startIndex: config.startIndex,
      endIndex: config.endIndex,
    }),
  ],

  renderers: [
    // Define the renderer plugins to render the attributes and image layers
    new renderers.ItemAttributesRenderer({
      name: config.name,
      description: config.description,
    }),
    new renderers.ImageLayersRenderer({
      width: config.inputWidth,
      height: config.inputHeight,
    }),
  ],

  exporters: [
    // Define the exporter plugins to export the generated artwork and metadata
    new exporters.ImagesExporter(),
    new exporters.Erc721MetadataExporter({
      imageUriPrefix: "",
    }),
  ],
});

// IIFE
(async () => {
  // Prepare sorted and size-checked assets before running ArtEngine
  await prepareAssets(config.inputWidth, config.inputHeight);
  // Run the Art Engine to generate the artwork
  await ae.run();

  // Rename images and update metadata
  const imagesDir = path.join(BASE_PATH, "output", "images");
  const metadataDir = path.join(BASE_PATH, "output", "erc721 metadata");

  try {
    // Read all JSON files from the metadata directory
    const files = fs
        .readdirSync(metadataDir)
        .filter((file) => file.endsWith(".json"));

    // Resize images to 2000x2000 and convert to WebP format
    console.log("🔄 Resizing and converting images to WebP...");
    for (const file of files) {
      const filePath = path.join(metadataDir, file);
      const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const pngImagePath = path.join(imagesDir, metadata.image);
      const webpImageName = metadata.image.replace(".png", ".webp");
      const webpImagePath = path.join(imagesDir, webpImageName);

      if (fs.existsSync(pngImagePath)) {
        console.log(
            `Converting ${metadata.image.replace(
                ".webp",
                ".png"
            )} to ${webpImageName}`
        );

        await sharp(pngImagePath)
            .resize(config.outputWidth, config.outputHeight, {
              fit: "cover",
              position: "center",
            })
            .webp({ quality: config.outputQuality })
            .toFile(webpImagePath);

        // Remove the original PNG file
        fs.unlinkSync(pngImagePath);

        // Update the filename in metadata to reflect WebP format
        metadata.image = webpImageName;

        // Save metadata to file
        fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
      }
    }

    console.log(
        `✅ Resized and converted all images to WebP format (${config.outputWidth}x${config.outputHeight}px, ${config.outputQuality}% quality)`
    );
  } catch (error) {
    console.error("❌ Error processing files:", error);
  }

  // Print performance metrics
  ae.printPerformance();
})();
