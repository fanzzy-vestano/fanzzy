import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const modules={};
async function load(name,deps={}) {
 const src=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',compiled)(id=>deps[id]||modules[id.slice(2)]||(()=>{throw Error(id)})(),mod,mod.exports);
 return modules[name]=mod.exports;
}
const sales=await load('sales-promotions');
const {calculateWebsiteSalesPromotion:calculate,allocateWebsiteOfferPrices}=await load('website-sales-promotions');
const now=new Date('2026-10-29T10:00:00Z');
const offer=(type,patch={})=>({...sales.newSalesPromotion(type),name:`Fixture ${type}`,value:20,...patch});
const delivery={enabled:true,amount:30,freeAboveEnabled:false,freeAbove:500};
const input=(promotions,patch={})=>({promotions,lines:[{productId:'A',category:'Anklets',price:100,quantity:2}],legacyCoupon:0,legacyPromotion:0,delivery,pickup:false,context:{now},...patch});

test('all item and basket offer families reduce the checkout total using SKU and quantities',()=>{
 for(const [p,expected] of [
  [offer('percentage'),40],[offer('flat'),40],[offer('rates',{productIds:['A'],rates:{A:70}}),60],
  [offer('spend-percent',{minSpend:200}),40],[offer('spend-amount',{minSpend:200}),20],
  [offer('quantity',{minQty:2,maxQty:1}),20],[offer('bogo',{value:100}),100],
  [offer('tiers',{tiers:[{quantity:2,percentage:25}]}),50],[offer('custom',{minSpend:200,minQty:2}),40],
  [offer('happy-hour',{startTime:'15:00',endTime:'16:00'}),40],
  [offer('category',{categoryNames:[' anklets ']}),40],
 ]) { const result=calculate(input([p]));assert.equal(result.promotionDiscount,expected,p.type);assert.equal(result.shippingTotal,30); }
});

test('categories match current product categories and exclude nonmatching products',()=>{
 const p=offer('category',{categoryNames:['Anklets']});
 assert.equal(calculate(input([p],{lines:[{productId:'NEW',category:'Anklets',price:200,quantity:1},{productId:'B',category:'Rings',price:500,quantity:1}]})).promotionDiscount,40);
 assert.equal(calculate(input([p],{lines:[{productId:'A',category:'Rings',price:100,quantity:2}]})).promotionDiscount,0);
});

test('buy/get and bundles discount existing cart items without adding or changing inventory lines',()=>{
 const lines=[{productId:'A',price:100,quantity:2},{productId:'B',price:50,quantity:1}];const saved=JSON.stringify(lines);
 const xy=offer('buy-x-y',{productIds:['A'],rewardProductIds:['B'],value:100});
 assert.equal(calculate(input([xy])).promotionDiscount,0);
 assert.equal(calculate(input([xy],{lines})).promotionDiscount,50);
 const bundle=offer('bundle',{productIds:['A','B'],bundleQuantities:{A:2,B:1},value:35});
 assert.equal(calculate(input([bundle],{lines})).promotionDiscount,35);assert.equal(JSON.stringify(lines),saved);
});

test('expired, paused, draft, future, wrong-day and wrong-time offers never discount',()=>{
 for(const patch of [{status:'Paused'},{status:'Draft'},{startDate:'2026-10-30'},{endDate:'2026-10-28'},{days:['Mon']},{startTime:'16:00',endTime:'17:00'}]) assert.equal(calculate(input([offer('percentage',patch)])).promotionDiscount,0);
});

test('best final delivered total wins without stacking or changing legacy Buy 1 Get X selections',()=>{
 const p=offer('percentage');
 assert.equal(calculate(input([p],{legacyCoupon:50})).couponDiscount,50);
 assert.equal(calculate(input([p],{legacyPromotion:60})).promotionDiscount,60);
 assert.equal(calculate(input([p],{hasGroupedPromotion:true})).offerId,'');
 assert.equal(calculate(input([p,offer('percentage',{value:30})])).promotionDiscount,60);
 const before=JSON.stringify(p);calculate(input([p]));assert.equal(JSON.stringify(p),before);
});

test('no new offers preserves legacy discounts, shipping thresholds, pickup and zero totals',()=>{
 for(const legacyCoupon of [0,20,180]) for(const legacyPromotion of [0,40,150]) for(const pickup of [false,true]) {
  const d={...delivery,freeAboveEnabled:true,freeAbove:150};
  const result=calculate(input([],{legacyCoupon,legacyPromotion,pickup,delivery:d}));
  assert.equal(result.couponDiscount,legacyCoupon);assert.equal(result.promotionDiscount,legacyPromotion);
  assert.equal(result.shippingTotal,pickup||Math.max(0,200-legacyCoupon-legacyPromotion)>=150?0:30);
 }
});

test('free delivery uses the real fee, excludes pickup, and does not mutate saved offer definitions',()=>{
 const p=offer('delivery',{productIds:['POS-DELIVERY'],minSpend:200});const before=JSON.stringify(p);
 assert.equal(calculate(input([p])).shippingTotal,0);assert.equal(calculate(input([p])).promotionDiscount,0);
 assert.equal(calculate(input([p],{pickup:true})).offerId,'');
 assert.equal(calculate(input([p],{lines:[{productId:'A',price:100,quantity:1}]})).shippingTotal,30);
 assert.equal(JSON.stringify(p),before);
});

test('offers never increase the final total when a discount loses free shipping',()=>{
 const result=calculate(input([offer('percentage',{value:10})],{delivery:{...delivery,freeAboveEnabled:true,freeAbove:200}}));
 assert.equal(result.offerId,'');assert.equal(result.shippingTotal,0);
});

test('coupon discounts require an applied matching code and preserve better legacy coupons',()=>{
 const p=offer('coupon',{couponCode:'SAVE20'});
 assert.equal(calculate(input([p])).couponDiscount,0);
 assert.equal(calculate(input([p],{context:{now,couponCode:'save20'}})).couponDiscount,20);
 assert.equal(calculate(input([p],{context:{now,couponCode:'SAVE20'},legacyCoupon:50})).couponDiscount,50);
});

test('first purchase fails closed without history and excludes returning customers',()=>{
 const p=offer('first');
 for(const context of [{},{customerPhone:'9876543210',historyAvailable:false},{customerPhone:'9876543210',historyAvailable:true,previousCustomerPhones:['+919876543210']}]) assert.equal(calculate(input([p],{context:{now,...context}})).promotionDiscount,0);
 assert.equal(calculate(input([p],{context:{now,customerPhone:'9876543210',historyAvailable:true,previousCustomerPhones:[]}})).promotionDiscount,40);
});

test('rounding and 100 percent offers never produce negative merchandise totals or discount COD fees',()=>{
 const result=calculate(input([offer('percentage',{value:100})]));
 assert.equal(result.promotionDiscount,200);assert.equal(result.shippingTotal,30);
 assert.equal(200-result.promotionDiscount+result.shippingTotal+20,50);
 assert.equal(calculate(input([offer('percentage',{value:33})],{lines:[{productId:'A',price:19.99,quantity:3}]})).promotionDiscount,19.79);
});

async function loader({promotions=[],orders=[],offerError=null,historyError=null}={}) {
 const reads=[];
 const service={fetchStoreSetting:async key=>{reads.push(key);return {value:JSON.stringify(promotions),error:offerError}},fetchStoreOrders:async opts=>{reads.push(opts);return {data:orders,error:historyError}}};
 const {loadWebsiteOffers}=await load('website-offers-client',{'./supabase/catalog':service});return {loadWebsiteOffers,reads};
}
test('storefront loads shared definitions only, without local fallback, writes or seeding',async()=>{
 const {loadWebsiteOffers,reads}=await loader();assert.deepEqual((await loadWebsiteOffers()).promotions,[]);assert.deepEqual(reads,['salesPromotions']);
 const failed=await loader({offerError:new Error('offline')});await assert.rejects(failed.loadWebsiteOffers(),/Offers could not be checked/);
});
test('first-purchase history counts paid and COD orders, ignores abandoned payments, and uses account or phone',async()=>{
 const customer={id:'customer',phone:'+919876543210'};
 for(const order of [{userId:'customer',paymentStatus:'paid'},{phone:'9876543210',paymentStatus:'cod_pending'},{userPhone:'9876543210',paymentStatus:'cod_collected'},{userId:'customer',razorpayPaymentId:'payment_fixture'}]) {
  const {loadWebsiteOffers}=await loader({promotions:[offer('first')],orders:[order]});const result=await loadWebsiteOffers(customer);
  assert.equal(result.context.historyAvailable,true);assert.deepEqual(result.context.previousCustomerPhones,[customer.phone]);
 }
 const {loadWebsiteOffers,reads}=await loader({promotions:[offer('first')],orders:[{userId:'customer',paymentStatus:'pending'}]});
 assert.deepEqual((await loadWebsiteOffers(customer)).context.previousCustomerPhones,[]);assert.deepEqual(reads[1],{includeDeleted:true});
 const failed=await loader({promotions:[offer('first')],historyError:new Error('offline')});assert.equal((await failed.loadWebsiteOffers(customer)).context.historyAvailable,false);
});

const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let submit;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='submitCheckout') submit=n.initializer.getText(ast);ts.forEachChild(n,visit)}visit(ast);
const compiledSubmit=ts.transpileModule(`return (${submit});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function checkout({changed=false,offline=false,grouped=false}={}) {
 const events=[],requests=[],saved=[],confirmations=[];let checkoutOptions;
 const p=offer('percentage');const websiteOfferInput=input([p],{hasGroupedPromotion:grouped});delete websiteOfferInput.promotions;delete websiteOfferInput.context;
 const onlineOffer=calculate({...websiteOfferInput,promotions:[p]});
 const orderTotal=200-onlineOffer.couponDiscount-onlineOffer.promotionDiscount+onlineOffer.shippingTotal;
 const noop=()=>{};
 const scope={isPaying:false,checkingOffersRef:{current:false},authUser:{id:'customer',phone:'9876543210'},cartStockIssues:[],cartHasSoldOutItems:false,paymentSettings:{online:true,cod:true},paymentMethod:'online',checkoutForm:{name:'Fixture',phone:'9876543210',email:'fixture@example.invalid',address:'Test address',pincode:'600001',landmark:'Test'},fulfillmentMethod:'delivery',selectedPickupHub:null,
  setCheckoutErrors:noop,setCheckingOffers:noop,setWebsiteOffers:noop,setOfferTime:noop,loadWebsiteOffers:async()=>{if(offline)throw Error('offline');return {promotions:changed?[]:[p],context:{}}},websiteOfferInput,websiteOffers:{promotions:[p],context:{}},calculateWebsiteSalesPromotion:calculate,allocateWebsiteOfferPrices,salesCouponCode:'',onlineOffer,orderTotal,couponDiscount:onlineOffer.couponDiscount,bogoDiscount:onlineOffer.promotionDiscount,deliveryTotal:onlineOffer.shippingTotal,codTotal:0,appliedCoupon:null,
  cartItems:[{id:'A',sku:'A',name:'Fixture Anklet',price:100,quantity:2}],getCartLinePrice:p=>p.price,getCustomerPrice:p=>p.price,formatINR:n=>`₹${n}`,setIsPaying:noop,
  persistConfirmedOrder:async order=>{confirmations.push(order)},persistPendingOrder:async order=>{saved.push(order);events.push('save')},razorpayApiUrl:path=>'/'+path,fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});if(url==='/reserve-stock')return Response.json({reserved:true,reservedAt:'fixture'});if(url==='/verify')return Response.json({verified:true,inventoryAdjusted:true});if(url==='/order')return Response.json({id:'order_fixture',amount:Math.round(orderTotal*100),keyId:'fixture'});throw Error('Unexpected request '+url)},readRazorpayResponse:r=>r.json(),loadRazorpayCheckout:async()=>class{constructor(options){checkoutOptions=options}open(){events.push('open')}},announce:message=>events.push(message),globalThis,Date,JSON,Math,Error,
 };
 await new Function(...Object.keys(scope),compiledSubmit)(...Object.values(scope))();
 return {events,requests,saved,confirmations,checkoutOptions,orderTotal};
}
test('real customer checkout saves the discount and hands the same total to the existing Razorpay flow',async()=>{
 const r=await checkout();assert.deepEqual(r.events,['save','save','save','open']);
 assert.equal(r.saved[0].promotionDiscount,40);assert.equal(r.saved[0].shippingTotal,30);assert.equal(r.saved[0].total,'₹190');
 assert.ok(r.saved[0].salesPromotionId);assert.equal(r.saved[0].items[0].price,'₹80');
 assert.deepEqual(r.requests.map(r=>r.url),['/reserve-stock','/order']);assert.equal(r.requests[1].body.amount,19000);assert.equal(r.checkoutOptions.amount,19000);
});
test('changed or unavailable offers stop checkout before any order, stock or payment mutation',async()=>{
 for(const options of [{changed:true},{offline:true}]) {const r=await checkout(options);assert.equal(r.requests.length,0);assert.equal(r.saved.length,0);assert.match(r.events[0],/Offers/)}
});

test('automatic discounts allocate exact paise to eligible item prices and preserve inventory quantities',()=>{
 const p=offer('category',{categoryNames:['Anklets'],value:33});
 const lines=[{productId:'A',category:'Anklets',price:19.99,quantity:3},{productId:'B',category:'Rings',price:50,quantity:2}];
 const result=calculate(input([p],{lines}));
 const allocated=allocateWebsiteOfferPrices(lines,p,result.promotionDiscount);
 const total=allocated.reduce((sum,row)=>sum+Math.round(row.price*100)*row.quantity,0);
 assert.equal(total,15997-Math.round(result.promotionDiscount*100));
 assert.equal(allocated.filter(row=>row.index===0).reduce((sum,row)=>sum+row.quantity,0),3);
 assert.deepEqual(allocated.filter(row=>row.index===1),[{index:1,quantity:2,price:50}]);
 assert.equal(allocateWebsiteOfferPrices(lines,undefined,0)[0].price,19.99);
});
test('buy/get discounts allocate to rewards and legacy grouped lines keep their prices',()=>{
 const p=offer('buy-x-y',{productIds:['A'],rewardProductIds:['B'],value:100});
 const lines=[{productId:'A',price:100,quantity:1},{productId:'B',price:50,quantity:1}];
 assert.deepEqual(allocateWebsiteOfferPrices(lines,p,50),[{index:0,quantity:1,price:100},{index:1,quantity:1,price:0}]);
 assert.deepEqual(allocateWebsiteOfferPrices(lines,undefined,0),[{index:0,quantity:1,price:100},{index:1,quantity:1,price:50}]);
});

test('verified payment keeps the discounted item prices and exact total in the confirmed order',async()=>{
 const r=await checkout();r.checkoutOptions.handler({razorpay_order_id:'order_fixture',razorpay_payment_id:'payment_fixture',razorpay_signature:'fixture'});
 for(let i=0;i<10&&!r.confirmations.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(r.confirmations.length,1);assert.equal(r.confirmations[0].total,'₹190');assert.equal(r.confirmations[0].items[0].price,'₹80');assert.equal(r.confirmations[0].paymentStatus,'paid');assert.equal(r.confirmations[0].inventoryAdjusted,true);
});
const {summarizeReturnableOrder}=await load('walk-in-returns');
test('existing returns use the actual discounted amount rather than the regular selling price',async()=>{
 const r=await checkout();const order={...r.saved[0],status:'Delivered',paymentStatus:'paid'};
 const summary=summarizeReturnableOrder(order);
 assert.equal(summary.lines[0].unitPrice,80);assert.equal(summary.lines[0].lineTotal,160);
});
