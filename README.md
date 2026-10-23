# Beehive Guide

One page per Utah community, built from public data and hosted on Firebase.

Run every command below from this `website` folder. You need Node.js (version 18 or newer).

## Folders

- `sources/` has the raw downloads used to build the site. Each source has its own folder. When a source takes more than one download (PRISM, NOAA, GNIS search exports), those files share a subfolder.
- `sources/sources.json` has each source's name, link and download date. Page citations use the names and links.
- `config/` has the files you edit by hand:
  - `site.json` holds the site name, tagline, web address, link style and phone prefix limits.
  - `excluded_places.json` lists places to leave out.
  - `included_places.json` lists places to keep even when UGRC doesn't list them.
  - `corrections.json` has fixes to source data, so the source files stay as downloaded.
  - `photos.json` lists each photo: its original, web versions, caption, alt text and credit.
- `scripts/` has the build steps, numbered in the order they run. `scripts/lib/` has the helpers the steps share. `scripts/tools/` has tools you run by hand that aren't part of the build, such as `filter_utah_stations.js` (see the NOAA note under Update a source).
- `templates/` has the HTML for the town pages, index, 404 page, header and footer.
- `static/` has files copied into the site as is: web fonts trimmed to Latin as WOFF2 (`static/fonts/`: Roboto Slab, Roboto and Zilla Slab), Bootstrap 5.0.2 and the site stylesheet (`static/css/`), Leaflet 1.9.4 for the maps (`static/leaflet/`) and web-sized photos (`static/images/`). Original downloads stay in `sources/fonts/`, `sources/libraries/` and `sources/photos/originals/`.
- `build/` holds the intermediate files. It's made by the scripts, so don't edit it.
- `public/` is the finished website. It's also made by the scripts.

## What goes where

The `beehiveguide` folder holds four things:

- `website/` is the project and the only part that goes to GitHub. Its `.gitignore` leaves out the built site (`public/`), the build steps' working files (except `build/communities.json`) and the raw data downloads in `sources/` (except `sources/sources.json`). Those stay on this computer.
- `drive/` is for files that sync to the Beehive Guide Google Drive: design files (icons, logo versions, social images) and full-size photo originals. The site doesn't use anything in it directly.
- `downloads/` is a staging folder for downloaded files that Claude needs to process. Download files here first, then have Claude move or process them into the right project folder. Nothing in this folder is used by the site or synced to GitHub.
- `trash/` is a holding spot for files we may not need. Nothing in it is used by the site or synced to GitHub.

## Syncing

**Google Drive:** `drive/` syncs to the Beehive Guide Google Drive (`beehiveguide@gmail.com`) through Google Drive for desktop. Keep it next to `website/`: `config/photos.json` points to the photo originals at `../drive/photos/originals/`.

**GitHub:** `website/` is the repository (`github.com/beehiveguide/website`), managed with Git in Terminal over SSH. The `.gitignore` keeps large and generated files out.

### One-time GitHub setup

1. Create an empty repository named `website` under the `beehiveguide` GitHub account. Do not add a README, license or `.gitignore` because these files already exist locally.
2. Set up an SSH key on this computer using the email on the GitHub account:

   ```sh
   ssh-keygen -t ed25519 -C "beehiveguide@gmail.com"
   eval "$(ssh-agent -s)"
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   pbcopy < ~/.ssh/id_ed25519.pub
   ```

   Press Enter to accept the default file location and add a passphrase if you like.

3. On GitHub, go to Settings → SSH and GPG keys → New SSH key. Paste the copied public key and save it.
4. Check the connection:

   ```sh
   ssh -T git@github.com
   ```

5. To keep the key loaded after a restart, add this to `~/.ssh/config`:

   ```text
   Host github.com
     AddKeysToAgent yes
     UseKeychain yes
     IdentityFile ~/.ssh/id_ed25519
   ```

### First push

After creating the empty GitHub repository and setting up SSH, run:

```sh
cd ~/Documents/beehiveguide/website
git init
git config user.name "Beehive Guide"
git config user.email "beehiveguide@gmail.com"
git add .
git status
```

Check the status carefully to make sure no large downloads or generated files are listed. Then run:

```sh
git commit -m "First commit"
git branch -M main
git remote add origin git@github.com:beehiveguide/website.git
git push -u origin main
```

### Future updates

After making changes to tracked project files:

```sh
git add .
git commit -m "What changed"
git push
```

**Firebase:** Deploy from this computer after a build (see Deploy below). The finished `public/` folder isn't stored on GitHub.

## Update a source

1. Download the new file into `downloads/`.
2. Move it into its folder under `website/sources/` and remove the old version. The scripts find most files by how their names start, so two versions in one folder can clash.
3. Change its `downloaded` date in `sources/sources.json`.
4. Build (see below) and check the counts the build prints.

| Source                                                       | Folder                           | Used for                                             |
| ------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------- |
| 2020 Census DHC (`utgeo2020.dhc` and `ut000012020.dhc` only) | `sources/census/ut2020.dhc/`     | Population, households, census places                |
| GNIS federal codes (`FederalCodes_UT.txt`)                   | `sources/gnis/federal-codes/`    | Master list of places                                |
| GNIS search exports (CSV)                                    | `sources/gnis/search-exports/`   | Elevation. Add as many exports as needed.            |
| UGRC SGID layers (GeoJSON)                                   | `sources/ugrc/`                  | Schools, parks, post offices, ZIP areas and more     |
| UGRC Populated Places 2010                                   | `sources/ugrc/populated-places/` | Which unincorporated places to keep, 2010 population |
| NANPA central office codes (`CoCodeAssignment...txt`)        | `sources/nanpa/`                 | Area codes, prefixes                                 |
| PRISM 1991-2020 normals (CSV)                                | `sources/prism/monthly_normals/` | Annual precipitation                                 |
| NOAA 1991-2020 annual/seasonal normals, by station (CSV)     | `sources/noaa/multivariate_annual_normals/` | Freeze-free days, last spring and first fall freeze |
| USDA hardiness zones by ZIP (`phzm_us_zipcode_2023.csv`)     | `sources/usda/`                  | Hardiness zone                                       |
| USPS post office pages (`post_office_urls.json`)             | `sources/usps/`                  | Post Office button                                   |
| Origins of Utah Place Names (`utah_place_names.json`)        | `sources/books/`                 | Founding year, name origin                           |

Notes:

- **PRISM:** PRISM takes at most 500 locations per batch. Upload lists live in `sources/prism/locations/`. After a build, `build/prism_locations_needed.csv` lists the communities still missing precipitation. Upload that file to PRISM and add the result to `sources/prism/monthly_normals/`.
- **NOAA:** Freeze data comes from NOAA's 1991-2020 Annual/Seasonal Normals. To update:
  1. Download the by-station archive (`us-climate-normals_1991-2020_..._annualseasonal_multivariate_by-station_....tar.gz`) from https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/archive/ into `downloads/`.
  2. Extract the CSVs into `sources/noaa/multivariate_annual_normals/`.
  3. Remove the non-Utah stations:

     ```sh
     node scripts/tools/filter_utah_stations.js sources/noaa/multivariate_annual_normals
     ```

     This keeps files whose station name ends in ", UT US" and **deletes the rest**. It can't be undone, so re-extract the archive if something goes wrong. It deletes nothing if no Utah files match.
  4. Build. `08b_freeze.js` uses NOAA's 50% dates for a 32°F freeze and gives a community a station's numbers only if the station is within 8 km and 100 m of elevation. Communities with no station that close get no freeze data, and the page leaves out that line. The limits are set at the top of the script, and the build prints each match so you can check it.
- **UGRC:** Keep the layer name at the start of the file name, like `Schools_PreKto12_...geojson`.
- **Fixing a value in a source:** Don't edit the source file. Add the fix to `config/corrections.json` with a note on why.

## Build

```sh
npm run build
```

This runs every step and rewrites `build/` and `public/`. It takes about 30 seconds.

To rebuild only the pages after changing a template or `config/site.json`:

```sh
npm run pages
```

To build a few pages somewhere else for testing:

```sh
node scripts/10_pages.js --out test-run Kanab Moab "Cedar City"
```

## Preview

Install the Firebase tools once:

```sh
npm install -g firebase-tools
firebase login
```

Then run:

```sh
npm run serve
```

Open the address it prints, usually [http://localhost:5000](http://localhost:5000).

## Deploy

1. The Firebase project is `beehiveguide-1847` (set in `.firebaserc`). Until the domain is connected, the site is at https://beehiveguide-1847.web.app.
2. One time only: set `url` in `config/site.json` to the site's address, such as `https://example.org`, with no slash at the end. The sitemap needs it.
3. Run:

   ```sh
   npm run deploy
   ```

This builds the site, rebuilds the pages with links that leave off ".html" (Firebase serves `kanab.html` at `/communities/kanab`), uploads `public/` to Firebase Hosting, then rebuilds the pages with ".html" links again so they still work when you open them on this computer.
