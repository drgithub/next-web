
var path = require('path');
var express = require('express');
var proxy = require('http-proxy-middleware');
var next = require('next');
var redirect = require("express-redirect");
const port = parseInt(process.env.PORT, 10) || 3000
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

const vacationDataTripThemesResolver = require('./src/data/resolveTripThemes');
const vacationDataTripThemePagesResolver = require('./src/data/resolveTripThemePages');
// const homepageDataResolver = require('./src/data/resolveHomepage');
const countryData = require('./src/data/countryData');
const countryHomeResolver = require('./src/data/resolveCountryHome');
const plusProfileResolver = require('./src/data/resolvePlusProfilePages');
const trustPilotResolver = require('./src/data/resolveTrustPilot');
const budgetResolver = require('./src/data/resolveBudget');
const serveRedirect = require('./src/serveRedirect');

// popup related
const csv = require('csv-parser');
const fs = require('fs')

// page specific popup data
const popupPageRules = []; // url_or_section,	pageviews,	country_tag,  title,	intro, contact_cta,	primary_cta,	primary_cta_url,	image_url
const popupGlobalRules = []; // url_or_section,	pageviews,	country_tag,  title,	intro, contact_cta,	primary_cta,	primary_cta_url,	image_url

fs.createReadStream('./src/data/popupRules.csv')
  .pipe(csv())
  // .on('end', () => { console.log(popupRules) })
  .on('data', (data) => {
    // global?
    const pv = data.pageviews || '0';
    if(pv == '0' || pv == '1') {
      popupPageRules.push(data); // non-global
    } else {
      popupGlobalRules.push(data); // global rules
    }
  });

function getPopups(req) {
  const countryTag = req.params.country || req.params.fcountry;
  const url = req.path || '';

  // console.log(req);
  // console.log(countryTag);
  // console.log(url);

  const me = popupPageRules
    .filter(rule => {
      const pattern = rule.url_or_section;
      if(rule.country && rule.country != countryTag) return false;                // exact country match needed
      if(pattern == url) return true;                                             // exact url matched
      // if(rule.url_or_section.endsWith(url)) return true;                       // ends with url match + country matched
      if(false == pattern.startsWith('/') && url.includes(pattern)) return true;  // url includes (section match)
      return false;
    })
  if (me && me.length > 0)  {
    // non-global match
    // console.log('non-global popup matched: ')
    // console.log(me[0])
    return me[0];
  }

  const mg = popupGlobalRules
    .filter(rule => {
      if(rule.country && rule.country != countryTag) return false;                         // exact country match needed
      if(rule.url_or_section && false == url.includes(rule.url_or_section)) return false;  // section match / partial page matched
      return true;
    });
  if (mg && mg.length > 0) {
    // console.log('global popup matched: ')
    // console.log(mg[0])
    return mg[0];
  }

  return null;

  // is there an exact match? just return that one
  // url = url or urlEndsWith & country matches

  // remove all that are not global match
  // remove all that are not partial match
};


function lc(path) { return '/:lc(es)?' + path; }
function glc(req) { return req.params.lc == 'es' ? 'es' : 'en'; }

function countryVal(res, req, locale) {
  const countryTag = req.params.country || req.params.fcountry;
  const selCountry = countryData.getCountryByTag(countryTag)
  const invalidCountry = selCountry.tag !== req.params.country || (locale == 'es' && !selCountry.activeEs);
    if (invalidCountry){
      console.log(`WARN - selected invalid country for 'aaa' countryInformation: ${countryTag}, locale ${locale}`)
      res.statusCode = 404;
      app.render(req, res, '/_error', {});
      return false
    } else
      return true;
};

function onProxyRes(proxyRes, req, res) {
  // proxyRes.headers['Cache-Control'] = 'must-revalidate' 
  proxyRes.headers['Cache-Control'] = 'private'
  // proxyRes.headers['Cache-Control'] = 'proxy-revalidate' 
  proxyRes.headers['Cache-Control'] = 'must-revalidate'
  // proxyRes.headers['Cache-Control'] = 'max-age=86400' 
  // delete proxyRes.headers['x-removed'] // remove header from response
  proxyRes.headers['Surrogate-Key'] = 'api'
}

function surrogateKeys(page,req,res)  {
  country = req && req.params && req.params.country;
  res.setHeader('Surrogate-Key', 'prerender ' + page + ' ' + country);
}


const apiProxy = ( 
  (process.env.ANYWHERE_ENV === 'production' || process.env.ANYWHERE_ENV === 'master')
     && process.env.NODE_ENV !== 'dev' ) 
  ? 'https://api-backend.anywhere.com' // production
  : 'https://api2.anywhere.com';       // staging

console.log('Nextjs proxy to api started: ' + apiProxy)


app.prepare().then(() => {
  const s = express();

  // testing env vars
  s.get('/env', (req,res) => {
    res.setHeader('Cache-Control', 'no-cache');
    console.log('____env')
    res.send({
      ANYWHERE_ENV: process.env.ANYWHERE_ENV,
      NODE_ENV: process.env.NODE_ENV,
      apiProxy: apiProxy
    })
  });

  // actual directives are implemented at the edge (fastly).
  // here we disallow all to ensure staging server doesn't get indexed
  s.get("/robots.txt", (req, res) => {
    res.send("User-agent: *\nDisallow: /")
  });
  s.use("/sitemap.xml", express.static(__dirname + "/src/assets/sitemap.xml"));

  redirect(s);
  serveRedirect.redirects(s);

  // non nextjs apps (account, org, admin)
  // 
  //

  s.get("/admin/reserve/modify/:id", function response(req, res) {
    app.render(req, res, '/reserve-modify', { locale: 'en', id: req.params.id, reserveType: req.query.type });
  });

  s.get("/admin*", function response(req, res) {
    res.sendFile(path.join(__dirname, "/dist/admin/index.html"));
  });
  // Provider Area
  s.get(lc('/org/:orgId/reserve_report_v2/:reserveReportId'), (req, res) => {
    surrogateKeys('org-reserve',req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/org-reserve', { locale: glc(req), orgId: req.params.orgId, reserveReportId: req.params.reserveReportId})
  });
  s.get(lc('/org/:orgId/reserve/v2/:reserveId'), (req, res) => {
    surrogateKeys('org-reserve',req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/org-reserve', { locale: glc(req), orgId: req.params.orgId, reserveId: req.params.reserveId})
  });
  // Legacy Provider Area
  s.get("/org*", function response(req, res) {
    res.sendFile(path.join(__dirname, "/dist/account/index.html"));
  });

  s.get(lc('/account/favorites'), (req, res) => app.render(req, res, '/favorites', { locale: glc(req) }));

  s.get(lc('/account/reviews/itinerary/:itineraryId'), (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-survey', { locale: glc(req), itineraryId: req.params.itineraryId });
  });

  
  s.get(lc('/account/reviews/thankyou'), (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-survey-thanks', { locale: glc(req) });
  });

  s.get(lc('/account/trips/:planFkey/:itineraryId'), (req, res) => {
    // TODO no index
    surrogateKeys('trips', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-trip', { locale: glc(req), planFkey: req.params.planFkey, itineraryId: req.params.itineraryId }) 
  })

  s.get(lc('/account/payment/:itineraryId'), (req,res) => {
    // TODO no index
    surrogateKeys('payment-online-booking', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-payment', { locale: glc(req), itineraryId: req.params.itineraryId })
  })

  s.get(lc('/account/payment/:planFkey/:itineraryId'), (req,res) => {
    // TODO no index
    surrogateKeys('payment', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-payment', { locale: glc(req), planFkey: req.params.planFkey, itineraryId: req.params.itineraryId })
  })

  s.get(lc('/account/tip/:planFkey/:itineraryId'), (req,res) => {
    // TODO no index
    surrogateKeys('tip', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-tip-offset', { locale: glc(req), itineraryId: req.params.itineraryId, planFkey: req.params.planFkey})
  })

  s.get(lc('/account/invite'), (req,res) => {
    // TODO no index
    surrogateKeys('account-invite', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-invite', { locale: glc(req) })
  })

  s.get(lc('/account/trip-intent/:planFkey'), (req,res) => {
    // TODO no index
    surrogateKeys('trip-intent', req, res);
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-trip-intent', { locale: glc(req), planFkey: req.params.planFkey})
  })

  s.get(lc('/account/trips/:planFkey'), (req, res) => {
    const trustPilotData = trustPilotResolver.resolve('');
    const limitedTpData = [ trustPilotData[0].slice(0,12), trustPilotData[1] ];
    res.setHeader('Cache-Control', 'no-cache');
    app.render(req, res, '/account-plan', { locale: glc(req), planFkey: req.params.planFkey, trustPilotData: limitedTpData });
  })

  s.get( lc('/account/book/tour/:bkId'), (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    app.render( req, res, '/tour-form', { locale: glc(req), bkId: req.params.bkId})
  })

  s.get("/account", function response(req, res) { res.sendFile(path.join(__dirname, "/dist/account/index.html")); });
  s.get("/account/*", function response(req, res) { res.sendFile(path.join(__dirname, "/dist/account/index.html")); });
  // SKIP s.get('/r/:id', (req, res) => app.render(req, res, '/user-referral-lp', { locale: 'en', id: req.params.id }))

  s.get("/es/account*", function response(req, res) { res.redirect(req.url.replace("es/account", "account")); });
  s.get("/user*", function response(req, res) { res.redirect(req.url.replace("user", "account")); });
  //
  //
  /// back to nextjs apps

  s.get(lc('/maps/trip'), (req, res) => {
    surrogateKeys('trips-map', req, res);
    app.render(req, res, '/trips-map', { locale: glc(req) })});


  // static paths
  s.use(express.static('public'));
  s.use('/static', express.static('src/assets'));
  s.use("/assets", express.static("dist"));

  // proxy / caching rules
  s.set("etag", false);

  s.get(lc('/search'), (req, res) => app.render(req, res, '/search', { locale: glc(req) }));

  // TO
  s.get('/plus', (req, res) => app.render(req, res, '/plus-index', { locale: 'en' })) // NO ES
  s.get('/plus/:plusTag', (req, res) => {
    const data = plusProfileResolver.resolvePlusProfile(req.params.plusTag);
    const errorCode =  (data ? null : 404);
    if(errorCode) {
      res.statusCode = errorCode;
      app.render(req, res, '/_error', {});
    } else {
      surrogateKeys('', req, res);
      app.render(req, res, '/plus-profile', { locale: 'en', plusTag: req.params.plusTag, data: data });
    }
  }) // NO ES
  // SKIP s.get('/r/:id', (req, res) => app.render(req, res, '/user-referral-lp', { locale: 'en', id: req.params.id }))
  // SKIP s.get('/provider-signup', (req, res) => app.render(req, res, '/provider-signup', { locale: 'en' }))

  // NO WP
  s.get(lc(''), (req, res) => {
    surrogateKeys('home', req, res);
    const trustPilotData = trustPilotResolver.resolve('');
    const limitedTpData = [ trustPilotData[0].slice(0,15), trustPilotData[1] ]
    // const data = homepageDataResolver.resolveHomepage(glc(req));
    app.render(req, res, '/home', { locale: glc(req) , trustPilot: limitedTpData });
  })
  s.get(lc('/company'), (req, res) => {
    surrogateKeys('company', req, res);
    app.render(req, res, '/company', { locale: glc(req) })})

  s.get(lc('/company/terms-of-service'), (req, res) => app.render(req, res, '/terms-of-service', { locale: glc(req) }))
  s.get(lc('/company/privacy'), (req, res) => app.render(req, res, '/privacy', { locale: glc(req) }))

  s.get(lc('/expert/:id'), (req, res) => {
    surrogateKeys('expert-profile', req, res);
    app.render(req, res, '/expert-profile', { locale: glc(req), id: req.params.id, popup: getPopups(req) })})
  // SKIP s.get('/trust', (req, res) => app.render(req, res, '/trust', { locale: 'en' }))
  s.get(lc('/testimonials'), (req, res) => {
    surrogateKeys('testimonials', req, res);
    const trustPilotData = trustPilotResolver.resolve('favorite');
    app.render(req, res, '/testimonials', { locale: glc(req), trustPilot: trustPilotData, popup: getPopups(req) })
  })

  s.get(lc('/trip-postponement'), (req, res) => {
    surrogateKeys('trip-postponement', req, res);
    app.render(req, res, '/trip-postponement', { locale: glc(req) })
  })

  s.get(lc('/insurance'), (req, res) => {
    surrogateKeys('insurance', req, res);
    app.render(req, res, '/insurance', { locale: glc(req) })
  })

  s.get(lc('/trips'), (req, res) => {
    surrogateKeys('trips', req, res);
    app.render(req, res, '/trips', { locale: glc(req), country: req.query.fcountry, title:req.query.title, popup: getPopups(req) })
  })

  s.get(lc('/:country/trip/:tripfkey'), (req, res) => {
    surrogateKeys('trips', req, res);
    app.render(req, res, '/country-trip', { locale: glc(req), country: req.params.country, tripfkey: req.params.tripfkey, popup: getPopups(req) }) })

  // WP
  s.get(lc('/:country/travel-guide/*'), (req, res) => {
    surrogateKeys('travel-guide', req, res);
    app.render(req, res, '/country-travel-guide', { locale: glc(req), country: req.params.country, amp: req.query.amp, popup: getPopups(req) })})
  s.get(lc('/:country/questions'), (req, res) => {
    surrogateKeys('faqs', req, res);
    app.render(req, res, '/faq-index', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})
  s.get(lc('/:country/questions/*'), (req, res) => {
    surrogateKeys('faqs', req, res);
    app.render(req, res, '/faq-page', { locale: glc(req), country: req.params.country, amp: req.query.amp, popup: getPopups(req) })})
  s.get(lc('/:country/sustainable'), (req, res) => {
    surrogateKeys('travel-guide', req, res);
    app.render(req, res, '/sustainable-index', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})
  s.get(lc('/:country/sustainable/*'), (req, res) => {
    surrogateKeys('travel-guide', req, res);
    app.render(req, res, '/sustainable-page', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})
  s.get(lc('/:country/videos'), (req, res) => {
    surrogateKeys('videos', req, res);
    app.render(req, res, '/videos', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})

  // NO WP
  s.get(lc('/:country/vacations/travel-planning'), (req, res) => {
    surrogateKeys('aaa', req, res);
    const locale = glc(req)
    if( countryVal(res,req, locale) ){
      const budgetData = budgetResolver.resolveBudget(req.params.country);
      const trustPilotData = trustPilotResolver.resolve([req.params.country, 'favorite']);
      app.render(req, res, '/aaa', { locale: locale, country: req.params.country
                                    , title: req.query.title
                                    , budgetData: budgetData
                                    , trustPilot: trustPilotData 
                                  });
    }
  })
  s.get(lc('/:country/vacations/travel-planning/thanks'), (req, res) => {
    surrogateKeys('aaa', req, res);
    app.render(req, res, '/aaa-thanks', { 
      locale: glc(req), 
      country: req.params.country,
      uid: req.query.uid,
      fkey: req.query.fkey,
      isAAA: req.query.isAAA
    })});
  
  s.get(lc('/:country/:theme-vacations'), (req, res) => {
    surrogateKeys('vacations', req, res);
    const trustPilotData = trustPilotResolver.resolve([req.params.country, 'favorite']);
    const data = vacationDataTripThemePagesResolver.resolveTripThemePages(glc(req), req.params.country, req.params.theme);
    const errorCode =  (data ? null : 404);
    if(errorCode) {
      res.statusCode = errorCode;
      app.render(req, res, '/_error', {});
    } else {
      app.render(req, res, '/vacations-theme', { locale: glc(req), country: req.params.country, data: data, trustPilot: trustPilotData, popup: getPopups(req) })
    }
  })
  // s.get(lc('/:country/recommend'), (req, res) => {
  //   surrogateKeys('aaa', req, res);
  //   app.render(req, res, '/recommend', { locale: glc(req), country: req.params.country })});
  s.get(lc('/:country/maps/:menu/:cat'), (req, res) => {
    surrogateKeys('maps', req, res);
    app.render(req, res, '/maps-category', { locale: glc(req), country: req.params.country, menu: req.params.menu, cat: req.params.cat, popup: getPopups(req) })});

  // NO SEO FOR NOW
  s.get(lc('/:country/maps'), (req, res) => {
    surrogateKeys('maps', req, res);
    app.render(req, res, '/maps', { locale: glc(req), country: req.params.country, menu: req.params.menu, cat: req.params.cat, popup: getPopups(req) })})
  // REDIRECT all old maps pages 
  s.get(lc('/:country/maps*'), (req, res) => res.redirect(glc(req) == 'es' ? `/es/${req.params.country}/maps` : `/${req.params.country}/maps`))

  // WP
  s.get(lc('/:country/regions/:region'), (req, res) => {
    surrogateKeys('region place', req, res);
    app.render(req, res, '/region-profile', { locale: glc(req), country: req.params.country, region: req.params.region, amp:req.query.amp, popup: getPopups(req) })})

  s.get(lc('/:country/destinations'), (req, res) => {
    surrogateKeys('destination place', req, res);
    app.render(req, res, '/destinations', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})

  s.get(lc('/:country/destinations/:id'), (req, res) => {
    surrogateKeys('destination place', req, res);
    app.render(req, res, '/destination-profile', { locale: glc(req), country: req.params.country, amp:req.query.amp, popup: getPopups(req)})})

  s.get(lc('/:country/destinations/:dest/hotels'), (req, res) => {
    surrogateKeys('hotels-in-destination', req, res);
    app.render(req, res, '/destination-hotels', { locale: glc(req), country: req.params.country, dest: req.params.dest, popup: getPopups(req) })})

  s.get(lc('/:country/destinations/:dest/hotels/:id'), (req, res) => {
    surrogateKeys('hotel', req, res);
    app.render(req, res, '/hotel-profile', { locale: glc(req), country: req.params.country, dest: req.params.dest, id: req.params.id, popup: getPopups(req) })})

  s.get(lc('/:country/destinations/:dest/tours'), (req, res) => {
    surrogateKeys('tours-in-destination', req, res);
    app.render(req, res, '/destination-tours', { locale: glc(req), country: req.params.country, dest: req.params.dest, popup: getPopups(req) })})

  s.get(lc('/:country/destinations/:dest/tours-:cat'), (req, res) => {
    surrogateKeys('destination-tours', req, res);
    app.render(req, res, '/destination-tours', { locale: glc(req), country: req.params.country, dest: req.params.dest, cat: req.params.cat, popup: getPopups(req) })})
    
  s.get(lc('/:country/destinations/:dest/tours/:id'), (req, res) => {
    surrogateKeys('tour', req, res);
    app.render(req, res, '/tour-profile', { locale: glc(req), country: req.params.country, dest: req.params.dest, id: req.params.id, popup: getPopups(req) })})

  s.get(lc('/:country/destinations/:type/:cat'), (req, res) => {
    surrogateKeys('destinations destination-cat', req, res);
    app.render(req, res, '/destination-cats', { locale: glc(req), country: req.params.country, cat: req.params.cat, popup: getPopups(req) })})

  s.get(lc('/:country/attractions/:cat(parques-nacionales|island|river|waterfall|archaeological-site|indigenous-culture|lake|beach|cultural|national-park|reserve|hike|traditional-market|cave|laguna|wildlife|reef|iconic|museum|historic|volcano|volcanoes|hiking|buddhist-site|isla|islas|rio|catarata|sitio-arqueologico|sitios-arqueologicos|cultura-indigena|lago|lagos|playa|cultural|parque-nacional|reserva|reservas|hike|mercado-tradicional|caverna|laguna|vida-silvestre|arrecife|simbolico|museo|historico|cascadas|mercados-tipicos|playas|historicos|cuevas|volcan)'), (req, res) => {
    surrogateKeys('attractions', req, res);
    app.render(req, res, '/attractiontype-category', { locale: glc(req), country: req.params.country, cat: req.params.cat})})

  s.get(lc('/:country/attractions/:cat'), (req, res) => {
    surrogateKeys('attractions', req, res);
    app.render(req, res, '/attraction-profile', { locale: glc(req), country: req.params.country, cat: req.params.cat,  amp:req.query.amp, popup: getPopups(req)  })})

  s.get(lc('/:country/transportation'), (req, res) => {
    surrogateKeys('transportation', req, res);
    const trustPilotData = trustPilotResolver.resolve(['transportation', 'favorite']);
    app.render(req, res, '/transportation', { locale: glc(req), country: req.params.country, trustPilot: trustPilotData, popup: getPopups(req) })})

  s.get(lc('/:country/transportation/:cat'), (req, res) => {
    surrogateKeys('transportation', req, res);
    const trustPilotData = trustPilotResolver.resolve(['transportation', 'favorite']);
    app.render(req, res, '/transportation-category', { locale: glc(req), country: req.params.country, trustPilot: trustPilotData, cat: req.params.cat, popup: getPopups(req) }) })
    
  s.get(lc('/:country/hotels'), (req, res) => {
    surrogateKeys('hotels', req, res);
    app.render(req, res, '/hotels', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})

  s.get(lc('/:country/hotels/:cat'), (req, res) => {
    surrogateKeys('hotels', req, res);
    app.render(req, res, '/hotel-category', { locale: glc(req), country: req.params.country, cat: req.params.cat, popup: getPopups(req) })})

  s.get(lc('/:country/tours'), (req, res) => {
    surrogateKeys('tours', req, res);
    app.render(req, res, '/tours', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})

  s.get(lc('/:country/tours/:cat'), (req, res) => {
    surrogateKeys('tours', req, res);
    app.render(req, res, '/tour-category', { locale: glc(req), country: req.params.country, cat: req.params.cat, popup: getPopups(req) })})

  s.get(lc('/:country/team'), (req, res) => {
    surrogateKeys('company team', req, res);
    app.render(req, res, '/team', { locale: glc(req), country: req.params.country, popup: getPopups(req) })})

  s.get(lc('/flora-fauna/:cat/:id'), (req, res) => {
    surrogateKeys('flora-fauna', req, res);
    app.render(req, res, '/flora-fauna-profile', { locale: glc(req), cat: req.params.cat, id: req.params.id })})

  s.get(lc('/flora-fauna/:cat'), (req, res) => {
    surrogateKeys('flora-fauna', req, res);
    app.render(req, res, '/flora-fauna-category', { locale: glc(req), cat: req.params.cat })})
  s.get(lc('/flora-fauna'), (req, res) => {
    surrogateKeys('flora-fauna', req, res);
    app.render(req, res, '/flora-fauna-index', { locale: glc(req) })})

  s.get(lc('/:country'), (req, res) => {
    surrogateKeys('country', req, res);
    const trustPilotData = trustPilotResolver.resolve([req.params.country, 'favorite']);
    const data = countryHomeResolver.resolveCountryHome(glc(req), req.params.country);
    // EXAMPLE of 404 error handling at routing level instead of punting
    // the error logic deeper into a View / Page component
    const errorCode =  (data ? null : 404);
    if(errorCode) {
      res.statusCode = errorCode;
      app.render(req, res, '/_error', {});
    } else {
      surrogateKeys('country-home', req, res);
      app.render(req, res, '/country-home', {
        data,
        locale: glc(req),
        country: req.params.country,
        trustPilot: trustPilotData,
        amp: req.query.amp
        , popup: getPopups(req)
      });
  }})

  // API proxy
  s.use('/api', proxy('/api', {
    target: apiProxy,
    changeOrigin: true,
    headers: { Origin: "http://localhost:3200" },
    onProxyRes: onProxyRes
  }));

  s.get('*', (req, res) => handle(req, res))

  s.listen(port, err => {
    if (err) throw err
    console.log(`> Ready  on http://localhost:${port}`)
  })
});
