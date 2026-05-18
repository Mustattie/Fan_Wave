-- Depends on: 024_geo_seed_and_fix.sql (added country/state/city columns)
-- Fix the bad geo seed from 024: groups were distributed across 12 cities by
-- ROW_NUMBER() % 12, which placed "Dallas Mavs" under Munich, "Yankees
-- Universe" under London, etc. Clear the random assignments and apply
-- name-based heuristics for major US/international team groups. Unmatched
-- groups are left with NULL geography (will NOT appear in the admin
-- Geography drill-down at all, which is the correct behavior — better than
-- false-positive placement).

-- 1. Reset all chat_rooms geo data
UPDATE chat_rooms SET country = NULL, state = NULL, city = NULL;

-- 2. Heuristic re-seed by name pattern. Order matters: more specific
-- patterns first, broader ones last (each chat_room takes the first match).

-- ─── United States — NFL ─────────────────────────────────────────────
UPDATE chat_rooms SET country='United States', state='Texas',           city='Dallas'          WHERE city IS NULL AND (name ILIKE '%cowboys%' OR name ILIKE '%mavs%' OR name ILIKE '%mavericks%' OR name ILIKE '%fc dallas%' OR name ILIKE '%dallas%' OR name ILIKE '%texas rangers%' OR name ILIKE '%stars%');
UPDATE chat_rooms SET country='United States', state='Texas',           city='Houston'         WHERE city IS NULL AND (name ILIKE '%texans%' OR name ILIKE '%astros%' OR name ILIKE '%rockets%' OR name ILIKE '%houston%');
UPDATE chat_rooms SET country='United States', state='Colorado',        city='Denver'          WHERE city IS NULL AND (name ILIKE '%broncos%' OR name ILIKE '%nuggets%' OR name ILIKE '%rockies%' OR name ILIKE '%denver%');
UPDATE chat_rooms SET country='United States', state='Georgia',         city='Atlanta'         WHERE city IS NULL AND (name ILIKE '%atlanta%' OR name ILIKE '%falcons%' OR name ILIKE '%hawks%' OR name ILIKE '%braves%');
UPDATE chat_rooms SET country='United States', state='New York',        city='New York City'   WHERE city IS NULL AND (name ILIKE '%yankee%' OR name ILIKE '%mets%' OR name ILIKE '%knicks%' OR name ILIKE '%nets%' OR name ILIKE '%giants%' OR name ILIKE '%jets%' OR name ILIKE '%new york%' OR name ILIKE '%nyc%');
UPDATE chat_rooms SET country='United States', state='Massachusetts',   city='Boston'          WHERE city IS NULL AND (name ILIKE '%celtics%' OR name ILIKE '%red sox%' OR name ILIKE '%patriots%' OR name ILIKE '%bruins%' OR name ILIKE '%boston%' OR name ILIKE '%new england%');
UPDATE chat_rooms SET country='United States', state='California',      city='Los Angeles'     WHERE city IS NULL AND (name ILIKE '%lakers%' OR name ILIKE '%clippers%' OR name ILIKE '%dodgers%' OR name ILIKE '%rams%' OR name ILIKE '%chargers%' OR name ILIKE '%la galaxy%' OR name ILIKE '%los angeles%');
UPDATE chat_rooms SET country='United States', state='California',      city='San Francisco'   WHERE city IS NULL AND (name ILIKE '%warriors%' OR name ILIKE '%49ers%' OR name ILIKE '%niners%' OR name ILIKE '%sf giants%' OR name ILIKE '%san francisco%');
UPDATE chat_rooms SET country='United States', state='Illinois',        city='Chicago'         WHERE city IS NULL AND (name ILIKE '%bulls%' OR name ILIKE '%bears%' OR name ILIKE '%cubs%' OR name ILIKE '%white sox%' OR name ILIKE '%blackhawks%' OR name ILIKE '%chicago%' OR name ILIKE '%fire fc%');
UPDATE chat_rooms SET country='United States', state='Florida',         city='Miami'           WHERE city IS NULL AND (name ILIKE '%heat%' OR name ILIKE '%marlins%' OR name ILIKE '%dolphins%' OR name ILIKE '%inter miami%' OR name ILIKE '%miami%');
UPDATE chat_rooms SET country='United States', state='Pennsylvania',    city='Philadelphia'    WHERE city IS NULL AND (name ILIKE '%76ers%' OR name ILIKE '%sixers%' OR name ILIKE '%eagles%' OR name ILIKE '%phillies%' OR name ILIKE '%flyers%' OR name ILIKE '%philadelphia%');
UPDATE chat_rooms SET country='United States', state='Pennsylvania',    city='Pittsburgh'      WHERE city IS NULL AND (name ILIKE '%steelers%' OR name ILIKE '%pirates%' OR name ILIKE '%penguins%' OR name ILIKE '%pittsburgh%');
UPDATE chat_rooms SET country='United States', state='Washington',      city='Seattle'         WHERE city IS NULL AND (name ILIKE '%seahawks%' OR name ILIKE '%mariners%' OR name ILIKE '%sounders%' OR name ILIKE '%seattle%' OR name ILIKE '%kraken%');
UPDATE chat_rooms SET country='United States', state='Wisconsin',       city='Milwaukee'       WHERE city IS NULL AND (name ILIKE '%bucks%' OR name ILIKE '%brewers%' OR name ILIKE '%milwaukee%');
UPDATE chat_rooms SET country='United States', state='Wisconsin',       city='Green Bay'       WHERE city IS NULL AND (name ILIKE '%packers%' OR name ILIKE '%green bay%');
UPDATE chat_rooms SET country='United States', state='Minnesota',       city='Minneapolis'     WHERE city IS NULL AND (name ILIKE '%vikings%' OR name ILIKE '%timberwolves%' OR name ILIKE '%twins%' OR name ILIKE '%wild%' OR name ILIKE '%minnesota%' OR name ILIKE '%minneapolis%');
UPDATE chat_rooms SET country='United States', state='Michigan',        city='Detroit'         WHERE city IS NULL AND (name ILIKE '%lions%' OR name ILIKE '%tigers%' OR name ILIKE '%pistons%' OR name ILIKE '%red wings%' OR name ILIKE '%detroit%');
UPDATE chat_rooms SET country='United States', state='Louisiana',       city='New Orleans'     WHERE city IS NULL AND (name ILIKE '%saints%' OR name ILIKE '%pelicans%' OR name ILIKE '%new orleans%');
UPDATE chat_rooms SET country='United States', state='Tennessee',       city='Nashville'       WHERE city IS NULL AND (name ILIKE '%titans%' OR name ILIKE '%predators%' OR name ILIKE '%nashville%');
UPDATE chat_rooms SET country='United States', state='Tennessee',       city='Memphis'         WHERE city IS NULL AND (name ILIKE '%grizzlies%' OR name ILIKE '%memphis%');
UPDATE chat_rooms SET country='United States', state='Missouri',        city='St. Louis'       WHERE city IS NULL AND (name ILIKE '%cardinals%' OR name ILIKE '%blues%' OR name ILIKE '%st. louis%' OR name ILIKE '%st louis%');
UPDATE chat_rooms SET country='United States', state='Missouri',        city='Kansas City'     WHERE city IS NULL AND (name ILIKE '%chiefs%' OR name ILIKE '%royals%' OR name ILIKE '%kansas city%');
UPDATE chat_rooms SET country='United States', state='Indiana',         city='Indianapolis'    WHERE city IS NULL AND (name ILIKE '%colts%' OR name ILIKE '%pacers%' OR name ILIKE '%indianapolis%');
UPDATE chat_rooms SET country='United States', state='Ohio',            city='Cleveland'       WHERE city IS NULL AND (name ILIKE '%browns%' OR name ILIKE '%cavaliers%' OR name ILIKE '%cavs%' OR name ILIKE '%guardians%' OR name ILIKE '%cleveland%');
UPDATE chat_rooms SET country='United States', state='Ohio',            city='Cincinnati'      WHERE city IS NULL AND (name ILIKE '%bengals%' OR name ILIKE '%reds%' OR name ILIKE '%cincinnati%');
UPDATE chat_rooms SET country='United States', state='Maryland',        city='Baltimore'       WHERE city IS NULL AND (name ILIKE '%ravens%' OR name ILIKE '%orioles%' OR name ILIKE '%baltimore%');
UPDATE chat_rooms SET country='United States', state='Arizona',         city='Phoenix'         WHERE city IS NULL AND (name ILIKE '%suns%' OR name ILIKE '%cardinals az%' OR name ILIKE '%diamondbacks%' OR name ILIKE '%coyotes%' OR name ILIKE '%phoenix%');
UPDATE chat_rooms SET country='United States', state='Nevada',          city='Las Vegas'       WHERE city IS NULL AND (name ILIKE '%raiders%' OR name ILIKE '%golden knights%' OR name ILIKE '%las vegas%' OR name ILIKE '%vegas%');
UPDATE chat_rooms SET country='United States', state='North Carolina',  city='Charlotte'       WHERE city IS NULL AND (name ILIKE '%panthers%' OR name ILIKE '%hornets%' OR name ILIKE '%charlotte%');

-- ─── United Kingdom — Premier League / English football ───────────────
UPDATE chat_rooms SET country='United Kingdom', state='England',        city='London'          WHERE city IS NULL AND (name ILIKE '%arsenal%' OR name ILIKE '%chelsea%' OR name ILIKE '%tottenham%' OR name ILIKE '%spurs%' OR name ILIKE '%west ham%' OR name ILIKE '%crystal palace%' OR name ILIKE '%fulham%' OR name ILIKE '%brentford%' OR name ILIKE '%london%');
UPDATE chat_rooms SET country='United Kingdom', state='England',        city='Manchester'      WHERE city IS NULL AND (name ILIKE '%man united%' OR name ILIKE '%manchester united%' OR name ILIKE '%man city%' OR name ILIKE '%manchester city%' OR name ILIKE '%manchester%');
UPDATE chat_rooms SET country='United Kingdom', state='England',        city='Liverpool'       WHERE city IS NULL AND (name ILIKE '%liverpool%' OR name ILIKE '%everton%');
UPDATE chat_rooms SET country='United Kingdom', state='Scotland',       city='Glasgow'         WHERE city IS NULL AND (name ILIKE '%celtic%' OR name ILIKE '%rangers fc%' OR name ILIKE '%glasgow%');

-- ─── International soccer / World Cup hubs ────────────────────────────
UPDATE chat_rooms SET country='Spain',          state='Catalonia',      city='Barcelona'       WHERE city IS NULL AND (name ILIKE '%barcelona%' OR name ILIKE '%fc barca%' OR name ILIKE '%barca%');
UPDATE chat_rooms SET country='Spain',          state='Madrid',         city='Madrid'          WHERE city IS NULL AND (name ILIKE '%real madrid%' OR name ILIKE '%atletico%' OR name ILIKE '%madrid%');
UPDATE chat_rooms SET country='France',         state='Île-de-France',  city='Paris'           WHERE city IS NULL AND (name ILIKE '%psg%' OR name ILIKE '%paris%');
UPDATE chat_rooms SET country='Germany',        state='Bavaria',        city='Munich'          WHERE city IS NULL AND (name ILIKE '%bayern%' OR name ILIKE '%munich%');
UPDATE chat_rooms SET country='Italy',          state='Lombardy',       city='Milan'           WHERE city IS NULL AND (name ILIKE '%milan%' OR name ILIKE '%inter milan%');
UPDATE chat_rooms SET country='Brazil',         state='São Paulo',      city='São Paulo'       WHERE city IS NULL AND (name ILIKE '%são paulo%' OR name ILIKE '%sao paulo%' OR name ILIKE '%corinthians%');
UPDATE chat_rooms SET country='Brazil',         state='Rio de Janeiro', city='Rio de Janeiro'  WHERE city IS NULL AND (name ILIKE '%flamengo%' OR name ILIKE '%rio de janeiro%' OR name ILIKE '%rio%');
UPDATE chat_rooms SET country='Argentina',      state='Buenos Aires',   city='Buenos Aires'    WHERE city IS NULL AND (name ILIKE '%boca%' OR name ILIKE '%river plate%' OR name ILIKE '%argentina%' OR name ILIKE '%buenos aires%');

-- 3. National-team / country fan groups — derive from country in name (no
-- specific city, just country/capital). Leave state NULL; UI shows
-- country-level.
UPDATE chat_rooms SET country='United States'    WHERE country IS NULL AND name ILIKE '%usa fan%';
UPDATE chat_rooms SET country='Mexico'           WHERE country IS NULL AND name ILIKE '%mexico fan%';
UPDATE chat_rooms SET country='Canada'           WHERE country IS NULL AND name ILIKE '%canada fan%';
UPDATE chat_rooms SET country='Brazil'           WHERE country IS NULL AND name ILIKE '%brazil fan%';
UPDATE chat_rooms SET country='Argentina'        WHERE country IS NULL AND name ILIKE '%argentina fan%';
UPDATE chat_rooms SET country='Germany'          WHERE country IS NULL AND name ILIKE '%germany fan%';
UPDATE chat_rooms SET country='France'           WHERE country IS NULL AND name ILIKE '%france fan%';
UPDATE chat_rooms SET country='Spain'            WHERE country IS NULL AND name ILIKE '%spain fan%';
UPDATE chat_rooms SET country='England'          WHERE country IS NULL AND name ILIKE '%england fan%';

-- Unmatched groups intentionally left with NULL country/state/city — they
-- won't appear under any city in the admin geography drill-down, which is
-- preferable to false-positive placement.
