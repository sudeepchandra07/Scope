/* floating blue cubes: sprites cut from bg-app.jpg, placed exactly over their original spots */
(function(){
var IW=1672,IH=941,C=[["cube0.png", 1088, 2, 88, 100], ["cube1.png", 944, 15, 44, 41], ["cube2.png", 1435, 77, 56, 60], ["cube3.png", 1560, 116, 80, 88], ["cube4.png", 1479, 206, 55, 59], ["cube5.png", 1611, 251, 47, 48], ["cube6.png", 1582, 613, 61, 67], ["cube7.png", 100, 664, 67, 72], ["cube8.png", 1510, 751, 74, 81], ["cube9.png", 312, 773, 64, 71], ["cube10.png", 1004, 812, 47, 42], ["cube11.png", 1348, 818, 52, 54], ["cube12.png", 1166, 837, 82, 87]];
var L=document.createElement('div');L.id='cubes';
C.forEach(function(c,i){var d=document.createElement('div');d.className='cb';var im=new Image();im.src='/'+c[0];im.alt='';d.appendChild(im);
d.style.setProperty('--dur',(5.5+(i*7%5)*0.9)+'s');d.style.setProperty('--dly',(-(i*1.3%6))+'s');d.style.setProperty('--ay',(9+(i%3)*3)+'px');d.style.setProperty('--r',((i%2?1:-1)*(2+(i%3)*0.8))+'deg');L.appendChild(d);});
document.body.insertBefore(L,document.body.firstChild);
function fit(){var z=window.__zf||1,w=window.innerWidth/z,h=window.innerHeight/z,s=Math.max(w/IW,h/IH),ox=(w-IW*s)/2;
[].forEach.call(L.children,function(d,i){var c=C[i];d.style.cssText+=';left:'+(ox+c[1]*s)+'px;top:'+(c[2]*s)+'px;width:'+(c[3]*s)+'px;height:'+(c[4]*s)+'px';});}
fit();addEventListener('resize',function(){fit();setTimeout(fit,60);setTimeout(fit,300);});setTimeout(fit,100);addEventListener('load',fit);
})();
