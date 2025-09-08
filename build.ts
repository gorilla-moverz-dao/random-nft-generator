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

const ae = new ArtEngine({
  cachePath: `${BASE_PATH}/cache`,
  outputPath: `${BASE_PATH}/output`,
  useCache: false,

  inputs: {
    // Define the input plugin (ImageLayersInput) to load image layers
    ruff: new inputs.ImageLayersInput({
      assetsBasePath: `${BASE_PATH}/data`,
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

(async () => {
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
