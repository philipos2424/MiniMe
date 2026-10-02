import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { validateOnboarding, ownerOnboardingResponse } from '../onboardingState.mjs';
import { resumeScreen, suggestedCurrency, ONBOARDING_TRIAL, CURRENCIES, guessCategory, countryFromPhone, countryFromTimeZone, factsStatement, CATEGORIES } from '../../onboarding-config.mjs';

test('private contacts never become business fields; identifiers and arbitrary data are ignored', () => {
  const result = validateOnboarding({business_id:'other-owner',owner_name:' Alex ',owner_contact_email:'alex@example.com',owner_contact_phone:'+1 (202) 555-0123',email:'public@example.com',owner_phone:'public',country_code:'US',currency:'USD',state:{screen:'contact',completed:['business','preview','made-up'],owner_contact_email:'leak@example.com',knowledge:true}});
  assert.deepEqual(result.business,{owner_name:'Alex',currency:'USD'});
  assert.equal(result.profile.owner_contact_phone,'+12025550123');
  assert.equal(result.profile.owner_contact_email,'alex@example.com');
  assert.equal(result.profile.business_id,undefined);
  assert.equal(result.profile.state.owner_contact_email,undefined);
  assert.deepEqual(result.profile.state.completed,['business','preview']);
});

test('optional contacts can be cleared and invalid country, currency, name, phone and email fail', () => {
  assert.equal(validateOnboarding({owner_contact_email:'',owner_contact_phone:''}).profile.owner_contact_email,null);
  for (const body of [{country_code:'ZZ'},{currency:'XYZ'},{owner_name:' '},{owner_contact_email:'invalid'},{owner_contact_phone:'2025550123'},{state:{screen:'unknown'}},{state:{screen:'offer',offer:'x'.repeat(4001)}}]) assert.throws(()=>validateOnboarding(body));
});

test('legacy interrupted flows resume safely and global currency suggestions are editable defaults', () => {
  assert.equal(resumeScreen('customer_chat'),'offer');
  assert.equal(resumeScreen('connect'),'location');
  assert.equal(resumeScreen('invalid'),'business');
  assert.equal(suggestedCurrency('IN'),'INR');
  assert.equal(suggestedCurrency('KE'),'KES');
  assert.equal(suggestedCurrency('US'),'USD');
  assert.equal(suggestedCurrency('DE'),'EUR');
  assert.equal(suggestedCurrency('AQ'),'');
  assert.equal(ONBOARDING_TRIAL.days,30);
});

test('business type is guessed from whole words in the name and always a valid category', () => {
  assert.equal(guessCategory('Mango Cafe'),'food_beverage');
  assert.equal(guessCategory('Abebe IT Solutions'),'it_tech');
  assert.equal(guessCategory('Habit Store'),'');
  assert.equal(guessCategory('Space Spa'),'beauty_wellness');
  assert.equal(guessCategory('Abebe & Sons'),'');
  for (const name of ['Phone Hub','Selam Boutique','City Garage','Print House','Wedding Events']) assert.ok(CATEGORIES.some(([key]) => key === guessCategory(name)), name);
});

test('country suggestions come from calling codes and known timezones only', () => {
  assert.equal(countryFromPhone('251911223344'),'ET');
  assert.equal(countryFromPhone('+254 712 345678'),'KE');
  assert.equal(countryFromPhone('+447700900000'),'GB');
  assert.equal(countryFromPhone('+12025550123'),'US');
  assert.equal(countryFromPhone(''),'');
  assert.equal(countryFromTimeZone('Africa/Addis_Ababa'),'ET');
  assert.equal(countryFromTimeZone('Mars/Olympus'),'');
});

test('real details become plain facts and only owner-written values are stated', () => {
  assert.equal(factsStatement({}),'');
  assert.equal(factsStatement({fact_price:' From 500 ETB ',fact_hours:'',fact_fulfilment:'pickup'}),'Typical prices: From 500 ETB. Customers pick up or visit us in person; we do not deliver.');
  assert.equal(factsStatement({fact_fulfilment:'teleport'}),'');
});

test('saved progress keeps real details and own offerings, and rejects unknown fulfilment', () => {
  const {profile} = validateOnboarding({state:{screen:'offer',fact_price:'From 500',fact_hours:'9-5',fact_fulfilment:'both',custom_offerings:[' Cakes ','Cakes','x'.repeat(40)]}});
  assert.equal(profile.state.fact_price,'From 500');
  assert.equal(profile.state.fact_fulfilment,'both');
  assert.deepEqual(profile.state.custom_offerings,['Cakes','x'.repeat(40)]);
  for (const state of [{screen:'offer',fact_fulfilment:'teleport'},{screen:'offer',fact_price:'x'.repeat(121)},{screen:'offer',custom_offerings:['x'.repeat(41)]}]) assert.throws(()=>validateOnboarding({state}));
});

const source = readFileSync(new URL('../../../app/api/onboarding/progress/route.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'');
const load = new Function('NextResponse','verifyTelegramInitData','parseTelegramUser','findByOwnerTelegramId','supabase','canonicalCategory','validateOnboarding','ownerOnboardingResponse',source.replace(/export const /g,'const ').replace(/export async function /g,'async function ')+'; return {GET,PATCH};');
function fixture() {
  const rows = new Map();
  const businesses = new Map([['one',{}],['two',{}]]);
  let fail = false;
  const db = {from(table) {
    let id, mode = 'read', payload;
    const q = {
      select(){return q;},eq(k,v){id=v;return q;},maybeSingle(){return q;},
      update(data){mode='update';payload=data;return q;},
      upsert(data){mode='upsert';payload=data;id=data.business_id;return q;},
      then(resolve){
        if(fail) return Promise.resolve({error:{message:'outage'}}).then(resolve);
        if(table==='businesses' && mode==='update') businesses.set(id,{...businesses.get(id),...payload});
        if(table==='business_onboarding' && mode==='upsert') rows.set(id,payload);
        return Promise.resolve({data:rows.get(id)||null,error:null}).then(resolve);
      },
    };return q;
  }};
  const api = load({json:(body,options)=>({body,status:options?.status||200,headers:options?.headers})},v=>['one','two'].includes(v),v=>({id:v}),async id=>({id}),()=>db,v=>v,validateOnboarding,ownerOnboardingResponse);
  return {api,rows,businesses,setFail:v=>{fail=v;}};
}
const request=(owner,body={})=>({headers:{get:()=>owner},json:async()=>body});

test('progress API isolates two owners and retains private contacts across stage-only saves',async()=>{
  const {api,rows,businesses} = fixture();
  assert.equal((await api.PATCH(request('one',{owner_contact_email:'one@example.com',owner_name:'One',country_code:'US'}))).status,200);
  assert.equal((await api.PATCH(request('one',{state:{screen:'review',knowledge:true}}))).status,200);
  assert.equal(rows.get('one').owner_contact_email,'one@example.com');
  assert.equal(rows.get('one').country_code,'US');
  assert.deepEqual(businesses.get('one'),{owner_name:'One'});
  assert.equal((await api.GET(request('two'))).body.owner_contact_email,undefined);
  assert.equal((await api.GET(request('one'))).body.owner_contact_email,'one@example.com');
  assert.equal((await api.GET(request('one'))).headers['Cache-Control'],'no-store');
  assert.equal((await api.PATCH(request('invalid',{owner_contact_email:'x@example.com'}))).status,401);
});

test('failed persistence never reports success or wipes previous progress',async()=>{
  const {api,rows,setFail} = fixture();
  await api.PATCH(request('one',{state:{screen:'offer'}}));
  setFail(true);
  assert.equal((await api.PATCH(request('one',{state:{screen:'review'}}))).status,503);
  assert.equal((await api.GET(request('one'))).status,503);
  assert.equal(rows.get('one').state.screen,'offer');
});

test('private onboarding SQL blocks public roles and cascades on account deletion',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  const id='00000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon;create role authenticated;create role service_role;create table businesses(id uuid primary key);insert into businesses values('${id}');`);
  const sql=readFileSync(new URL('../../../../../../packages/db/migrations/057_guided_onboarding.sql',import.meta.url),'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.query('insert into business_onboarding(business_id,owner_contact_email) values($1,$2)',[id,'private@example.com']);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from business_onboarding'),/permission denied/);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(db.query('select * from business_onboarding'),/permission denied/);
  await db.exec('reset role');
  await db.query('delete from businesses where id=$1',[id]);
  assert.equal((await db.query('select count(*)::int n from business_onboarding')).rows[0].n,0);
});

test('v2 analytics only record bounded, non-personal metadata',async()=>{
  const code=readFileSync(new URL('../../../app/api/onboarding/track/route.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace(/export const /g,'const ').replace('export async function POST','async function POST');
  let inserted;
  const post=new Function('NextResponse','verifyTelegramInitData','parseTelegramUser','supabase',code+';return POST;')({json:body=>body},()=>true,()=>({id:1}),()=>({from:()=>({insert:async data=>{inserted=data;}})}));
  await post(request('one',{step:'v2_contact_saved',meta:{owner_contact_email:'secret@example.com',phone_provided:true,screen:'contact',elapsed_ms:2000,error:'secret'}}));
  assert.deepEqual(inserted.meta,{elapsed_ms:2000,phone_provided:true,screen:'contact'});
});

const teachingSource=readFileSync(new URL('../teaching.js',import.meta.url),'utf8');
test('teaching does not report success when chunk storage fails',async()=>{
  const code=teachingSource.slice(teachingSource.indexOf('export async function saveBusinessBrief('),teachingSource.indexOf('export async function saveClientFacts(')).replace('export async function','async function');
  let readyWrites=0;
  const db={from(table){const q={insert(){return q;},select(){return q;},single(){return q;},eq(){return q;},update(value){if(value.status==='ready')readyWrites++;return q;},then(resolve){return Promise.resolve(table==='document_chunks'?{error:{message:'storage outage'}}:{data:{id:'doc'},error:null}).then(resolve);}};return q;}};
  const save=new Function('supabase','chunkText','embedOne','canonicalCategory',code+';return saveBusinessBrief;')(()=>db,t=>[t],async()=>[0.1],v=>v);
  assert.equal((await save('one',{text:'We deliver locally',extracted:null})).ok,false);
  assert.equal(readyWrites,0);
});

test('catalog extraction keeps global prices in their stated currency',async()=>{
  const code=teachingSource.slice(teachingSource.indexOf('export async function extractProductsFromText('),teachingSource.indexOf('export async function extractProductFromMessage(')).replace('export async function','async function');
  const openai={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({products:[{name:'Planter',price:250,currency:'KES'},{name:'Repair',price:400,currency:'INR'}]})}}]})}}};
  const extract=new Function('openai','MODEL_MINI','CURRENCIES',code+';return extractProductsFromText;')(openai,'fixture',CURRENCIES);
  const products=await extract('Planter KES 250. Repair INR 400.');
  assert.equal(products[0].currency,'KES');assert.equal(products[1].currency,'INR');
});

test('corrected FAQ persistence failures surface instead of showing a false saved state',async()=>{
  const engine=readFileSync(new URL('../replyEngine.js',import.meta.url),'utf8');
  const code=engine.slice(engine.indexOf('export async function saveFaqPair('),engine.indexOf('export async function learnFromOwnerReply(')).replace('export async function','async function');
  let embedded=false;
  const db={from(){let writing=false;const q={select(){return q;},eq(){return q;},single(){return q;},update(){writing=true;return q;},then(resolve){return Promise.resolve(writing?{error:{message:'fixture outage'}}:{data:{owner_instructions:[]},error:null}).then(resolve);}};return q;}};
  const save=new Function('supabase','saveLessonAsDocument',code+';return saveFaqPair;')(()=>db,async()=>{embedded=true;});
  await assert.rejects(save('one','Delivery?','Two days'),/Could not save/);
  assert.equal(embedded,false);
});

test('private reply previews survive separate workers and reject other owners and expired tokens',async()=>{
  const code=readFileSync(new URL('../onboardingPreview.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace(/export async function /g,'async function ');
  const rows=[];
  const db={from(){let filters=[],mode='read',payload;const q={
    select(){return q;},maybeSingle(){return q;},insert(value){mode='insert';payload=value;return q;},delete(){mode='delete';return q;},
    eq(key,value){filters.push(r=>String(r[key])===String(value));return q;},
    gt(key,value){filters.push(r=>r[key]>value);return q;},lt(key,value){filters.push(r=>r[key]<value);return q;},
    then(resolve){if(mode==='insert')rows.push(payload);const matches=rows.filter(r=>filters.every(fn=>fn(r)));if(mode==='delete')for(const row of matches)rows.splice(rows.indexOf(row),1);return Promise.resolve({data:matches[0]||null,error:null}).then(resolve);},
  };return q;}};
  const worker=()=>new Function('crypto','supabase',code+';return {storePreviewSession,getPreviewSession};')({randomUUID:()=> '00000000-0000-4000-8000-000000000001'},()=>db);
  const token=await worker().storePreviewSession(123,{business_id:'one',question:'Delivery?',draft:'Two days'});
  assert.equal((await worker().getPreviewSession(token,123)).draft,'Two days');
  assert.equal(await worker().getPreviewSession(token,999),null);
  rows[0].expires_at='2000-01-01T00:00:00.000Z';
  assert.equal(await worker().getPreviewSession(token,123),null);
});
