// Plasmo's data-text: scheme inlines a file's contents as a string at build
// time. Used to inject the fader stylesheet as a same-origin <style>, which
// the manifest's css array cannot do.
declare module "data-text:*" {
  const content: string;
  export default content;
}
