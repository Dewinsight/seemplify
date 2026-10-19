'use strict';
function retained(source,now=new Date()){return Boolean(source&&source.status==='ready'&&(!source.retention?.expiresAt||new Date(source.retention.expiresAt)>now));}
function effective(source,now=new Date()){return source?.status==='ready'&&!retained(source,now)?{...source,status:'expired'}:source;}
module.exports={retained,effective};
