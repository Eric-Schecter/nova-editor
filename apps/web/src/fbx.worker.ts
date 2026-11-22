self.onmessage = async ({ data: { input, target, moduleURL } }) => {
  const errors: string[] = [];
  try {
    const { default: createConverter } = await import(/* @vite-ignore */ moduleURL);
    const converter = await createConverter({
      locateFile: (name: string) => new URL(name, moduleURL).href,
      printErr: (line: string) => errors.push(line),
    });
    const source = target === "glb" ? "/input.fbx" : "/input.glb";
    const destination = "/output." + target;
    converter.FS.writeFile(source, new Uint8Array(input));
    const status = converter.callMain([source, destination]);
    if (status) throw Error(errors.join("\n") || "Assimp 转换失败");
    const output = converter.FS.readFile(destination).slice().buffer;
    self.postMessage({ output }, { transfer: [output] });
  } catch (error) {
    self.postMessage({ error: errors.join("\n") || String(error) });
  }
};
