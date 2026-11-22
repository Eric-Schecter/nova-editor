(function(){"use strict";self.onmessage=async({data:{input:u,target:n,moduleURL:o}})=>{const t=[];try{const{default:r}=await import(o),s=await r({locateFile:e=>new URL(e,o).href,printErr:e=>t.push(e)}),i=n==="glb"?"/input.fbx":"/input.glb",a="/output."+n;if(s.FS.writeFile(i,new Uint8Array(u)),s.callMain([i,a]))throw Error(t.join(`
`)||"Assimp 转换失败");const c=s.FS.readFile(a).slice().buffer;self.postMessage({output:c},{transfer:[c]})}catch(r){self.postMessage({error:t.join(`
`)||String(r)})}}})();
