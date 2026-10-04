import test from 'node:test';
import assert from 'node:assert/strict';
import {artistTags} from './character-tools.mjs';
import {parseArtistImport,normalizeArtist,withDefaultArtists} from './drawing-preferences.mjs';
import {installArtistBundle} from './artist-bundle.mjs';

test('chat-pasted artist names discard invisible word joiners before adding @',()=>{
    const artists=parseArtistImport('\u2060@ask\u2060    \u2060@wlop\u2060   \u2060@citemer\u2060');
    assert.deepEqual(artists.map(a=>a.tags),[['@ask'],['@wlop'],['@citemer']]);
    assert.deepEqual(artists.map(a=>a.name),['ask','wlop','citemer']);
    assert.deepEqual(normalizeArtist('\ufeff \u200b@ask\u2060 '),{name:'ask',tags:['@ask']});
});
test('multiword artist names stay intact and JSON preset tags are cleaned',()=>{
    assert.deepEqual(parseArtistImport('some artist\n@another artist @wlop').map(a=>a.tags),[['@some artist'],['@another artist'],['@wlop']]);
    assert.deepEqual(parseArtistImport(JSON.stringify([{name:'\u2060ask',tags:['\u200b@ask\u2060']}]))[0],{name:'ask',tags:['@ask']});
    assert.deepEqual(artistTags(['@ask','\u2060@ask','@wlop\u200b']),['@ask','@wlop']);
});
test('paste normalization does not admit artist control markers or paths',()=>{
    for(const input of ['\u2060@style:pc98','\u200b@character:someone','@../ask','@ask; BREAK'])assert.throws(()=>parseArtistImport(input));
});
test('all three selected presets reach the positive prompt and replace the previous artist',()=>{
    const original='masterpiece, @style:ModelDefault, @old painter; girl, reading';
    for(const artist of ['@ask','@wlop','@citemer']){
        const prompt=withDefaultArtists(original,[artist],['@old painter']);
        assert.ok(prompt.includes(artist));assert.ok(!prompt.includes('@old painter'));
        assert.ok(prompt.includes('@style:ModelDefault'));assert.ok(prompt.includes('; girl, reading'));
    }
});
test('phone update adds requested presets once without changing an existing selection',()=>{
    const settings={default_artist_id:'custom',artist_presets:[{name:'mine',tags:['@mine']},{name:'wlop',tags:['@wlop']}]};
    const app={importArtists:input=>{for(const row of parseArtistImport(input))if(!settings.artist_presets.some(r=>r.tags.join(',')===row.tags.join(',')))settings.artist_presets.push(row);}};
    assert.equal(installArtistBundle(app,settings),true);
    assert.equal(settings.default_artist_id,'custom');assert.equal(settings.artist_presets.length,4);
    assert.equal(settings.artist_presets.filter(r=>r.tags.includes('@wlop')).length,1);
    settings.artist_presets=settings.artist_presets.filter(r=>!r.tags.includes('@ask'));
    assert.equal(installArtistBundle(app,settings),false);
    assert.equal(settings.artist_presets.some(r=>r.tags.includes('@ask')),false);
});
test('failed bundle import can retry after initialization recovers',()=>{
    const settings={};assert.throws(()=>installArtistBundle({importArtists(){throw Error('Unavailable');}},settings));
    assert.equal(settings.artistBundleVersion,undefined);
    assert.equal(installArtistBundle({importArtists(){}},settings),true);
});
