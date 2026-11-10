const result = await Bun.build({
  entrypoints: [new URL("./index.html", import.meta.url).pathname],
  outdir: new URL("./dist", import.meta.url).pathname,
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
}
if (result.success) {
  await Bun.write(new URL("./dist/ruf-baylor-logo.png", import.meta.url), Bun.file(new URL("../../assets/ruf-baylor-logo.png", import.meta.url)));
}
