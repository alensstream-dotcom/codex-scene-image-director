export const ARTIST_BUNDLE_VERSION='2.1.6';
export const BUNDLED_ARTISTS=['@ask','@wlop','@citemer'];
/** Add the requested presets once; preserve selections and subsequent deletions. */
export function installArtistBundle(app,settings){
    if(settings.artistBundleVersion===ARTIST_BUNDLE_VERSION)return false;
    app.importArtists(BUNDLED_ARTISTS);
    settings.artistBundleVersion=ARTIST_BUNDLE_VERSION;
    return true;
}
