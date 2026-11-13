import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRequestHeaders } from '../server/network.mjs';
import { CNN_URL, ARCHIVE_URL } from '../server/updater.mjs';

test('CNN配置防拦截来源请求头，避免通用下载器丢失来源参数', () => {
 const headers=publicRequestHeaders(CNN_URL);
 assert.ok(headers['User-Agent']&&headers['User-Agent']!=='Mozilla/5.0');
 assert.ok(headers.Accept);
 assert.equal(headers.Origin,'https://www.cnn.com');
 assert.equal(headers.Referer,'https://www.cnn.com/');
});

test('CNN请求参数不影响Yahoo或第三方源，也不匹配仿冒域名', () => {
 for(const url of [ARCHIVE_URL,'https://query1.finance.yahoo.com/v8/finance/chart/SPY',CNN_URL.replace('cnn.io','cnn.io.invalid')]) {
  assert.deepEqual(publicRequestHeaders(url),{'User-Agent':'Mozilla/5.0'});
 }
});


test('允许通过CNN_FETCH_USER_AGENT显式配置，空值回退默认', () => {
 const saved=process.env.CNN_FETCH_USER_AGENT;
 try {
  process.env.CNN_FETCH_USER_AGENT='configured-cnn-agent';
  assert.equal(publicRequestHeaders(CNN_URL)['User-Agent'],'configured-cnn-agent');
  assert.equal(publicRequestHeaders(ARCHIVE_URL)['User-Agent'],'Mozilla/5.0');
  process.env.CNN_FETCH_USER_AGENT='';
  assert.ok(publicRequestHeaders(CNN_URL)['User-Agent']&&publicRequestHeaders(CNN_URL)['User-Agent']!=='Mozilla/5.0');
 } finally {
  if(saved===undefined)delete process.env.CNN_FETCH_USER_AGENT;else process.env.CNN_FETCH_USER_AGENT=saved;
 }
});
