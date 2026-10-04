/** Standard ZIP (stored entries), with UTF-8 filenames. No external dependency. */
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
export function imageZip(assets){
    const parts=[],directory=[];let offset=0,total=0;
    for(const[a,asset]of assets.entries()){
        const match=asset.data?.match(/^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/);if(!match)throw new Error('缓存图片格式无效。');
        const raw=atob(match[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),name=new TextEncoder().encode(String(a+1).padStart(3,'0')+'_'+(asset.created_at||'image').replace(/[^0-9T-]/g,'_')+'.'+(match[1]==='jpeg'?'jpg':match[1])),crc=crc32(bytes);
        const header=new Uint8Array(30),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);
        const central=new Uint8Array(46),d=new DataView(central.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);
        parts.push(header,name,bytes);directory.push(central,name);offset+=header.length+name.length+bytes.length;total+=central.length+name.length;
    }
    if(assets.length>65535||offset+total>0xffffffff)throw new Error('所选图片过多，请分批下载。');
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,assets.length,true);e.setUint16(10,assets.length,true);e.setUint32(12,total,true);e.setUint32(16,offset,true);return new Blob([...parts,...directory,end],{type:'application/zip'});
}
