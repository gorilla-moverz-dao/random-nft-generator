const config = {
  // Start after 1 if you have reserved 1:1 images
  startIndex: 10,
  endIndex: 30,
  name: (itemUid: number) =>
    `Jungle Creatures #${String(itemUid).padStart(4, "0")}`,
  description: (attributes: any) => {
    return `The jungle creatures collection on Movement`;
  },
  inputWidth: 1024,
  inputHeight: 1024,
  outputWidth: 640,
  outputHeight: 640,
  outputQuality: 90,
};
export default config;
