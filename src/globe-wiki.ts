/**
 * GlobeWiki — the Wikipedia/NASA lookup subsystem, ported VERBATIM from the
 * .Me globe (methods lifted out of the Angular component into a plain class,
 * bodies untouched). Used EVERYWHERE (stars, constellations, planets, cities),
 * so it lives on its own. All requests hit PUBLIC APIs (Wikipedia REST + w/api,
 * NASA images) with `origin=*` CORS — no backend, no database.
 */
import type { CelestialStarDefinition } from './celestial/celestial-environment';

export type WikiSummary = {
  title: string;
  extract: string;
  thumb?: string;
  url?: string;
};

/** A Wikipedia page that has a primary coordinate on Earth. */
export type EarthSearchResult = {
  title: string;
  latDeg: number;
  lonDeg: number;
};

export class GlobeWiki {
  private readonly starWikiCache = new Map<
    string,
    Promise<WikiSummary | null>
  >();
  private readonly cityWikiCache = new Map<
    string,
    Promise<WikiSummary | null>
  >();
  private readonly nasaHitsCache = new Map<string, Promise<number>>();

  public fetchWikiSummaryOnce(title: string): Promise<WikiSummary | null> {
    let cached = this.starWikiCache.get(title);

    if (!cached) {
      cached = (async () => {
        try {
          const response = await fetch(
            'https://en.wikipedia.org/api/rest_v1/page/summary/' +
              encodeURIComponent(title)
          );

          if (!response.ok) {
            return null;
          }

          const data = (await response.json()) as {
            type?: string;
            title?: string;
            extract?: string;
            thumbnail?: { source?: string };
            content_urls?: { desktop?: { page?: string } };
          };

          if (data.type === 'disambiguation' || !data.extract) {
            return null;
          }

          return {
            title: data.title ?? title,
            extract: data.extract,
            thumb: data.thumbnail?.source,
            url: data.content_urls?.desktop?.page
          };
        } catch {
          return null; // Offline or blocked — silently nothing.
        }
      })();

      this.starWikiCache.set(title, cached);
    }

    return cached;
  }

  /** HYG designation pieces → real Wikipedia titles. */
  private static readonly STAR_GREEK: Record<string, string> = {
    Alp: 'Alpha', Bet: 'Beta', Gam: 'Gamma', Del: 'Delta', Eps: 'Epsilon',
    Zet: 'Zeta', Eta: 'Eta', The: 'Theta', Iot: 'Iota', Kap: 'Kappa',
    Lam: 'Lambda', Mu: 'Mu', Nu: 'Nu', Xi: 'Xi', Omi: 'Omicron', Pi: 'Pi',
    Rho: 'Rho', Sig: 'Sigma', Tau: 'Tau', Ups: 'Upsilon', Phi: 'Phi',
    Chi: 'Chi', Psi: 'Psi', Ome: 'Omega'
  };

  private static readonly CONSTELLATION_GENITIVE: Record<string, string> = {
    And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii',
    Aql: 'Aquilae', Ara: 'Arae', Ari: 'Arietis', Aur: 'Aurigae',
    Boo: 'Boötis', Cae: 'Caeli', Cam: 'Camelopardalis', Cnc: 'Cancri',
    CVn: 'Canum Venaticorum', CMa: 'Canis Majoris', CMi: 'Canis Minoris',
    Cap: 'Capricorni', Car: 'Carinae', Cas: 'Cassiopeiae', Cen: 'Centauri',
    Cep: 'Cephei', Cet: 'Ceti', Cha: 'Chamaeleontis', Cir: 'Circini',
    Col: 'Columbae', Com: 'Comae Berenices', CrA: 'Coronae Australis',
    CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis',
    Cyg: 'Cygni', Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis',
    Equ: 'Equulei', Eri: 'Eridani', For: 'Fornacis', Gem: 'Geminorum',
    Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae',
    Hyi: 'Hydri', Ind: 'Indi', Lac: 'Lacertae', Leo: 'Leonis',
    LMi: 'Leonis Minoris', Lep: 'Leporis', Lib: 'Librae', Lup: 'Lupi',
    Lyn: 'Lyncis', Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii',
    Mon: 'Monocerotis', Mus: 'Muscae', Nor: 'Normae', Oct: 'Octantis',
    Oph: 'Ophiuchi', Ori: 'Orionis', Pav: 'Pavonis', Peg: 'Pegasi',
    Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris', Psc: 'Piscium',
    PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli',
    Sge: 'Sagittae', Sgr: 'Sagittarii', Sco: 'Scorpii', Scl: 'Sculptoris',
    Sct: 'Scuti', Ser: 'Serpentis', Sex: 'Sextantis', Tau: 'Tauri',
    Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis',
    Tuc: 'Tucanae', UMa: 'Ursae Majoris', UMi: 'Ursae Minoris',
    Vel: 'Velorum', Vir: 'Virginis', Vol: 'Volantis', Vul: 'Vulpeculae'
  };

  public buildStarWikiCandidates(star: CelestialStarDefinition): string[] {
    const name = star.name.replace(/\s+/g, ' ').trim();

    if (!name) {
      return [];
    }

    if (name === 'Sol') {
      return ['Sun']; // Our catalog name vs the Wikipedia title.
    }

    const genitive = GlobeWiki.CONSTELLATION_GENITIVE[star.constellation];
    const tokens = name.split(' ');
    let designationTail = tokens[tokens.length - 1];

    const looksLikeDesignation =
      /\d/.test(name) ||
      designationTail.toLowerCase() === star.constellation.toLowerCase();

    if (!looksLikeDesignation) {
      return [name, `${name} (star)`];
    }

    if (!genitive) {
      return [];
    }

    // Superscript glued to the tail: «37Xi 2Sgr» → superscript 2, abbr Sgr.
    let superscript = '';
    const tailMatch = designationTail.match(/^(\d)([A-Za-z]{2,3})$/);

    if (
      tailMatch &&
      tailMatch[2].toLowerCase() === star.constellation.toLowerCase()
    ) {
      superscript = tailMatch[1];
      designationTail = tailMatch[2];
    }

    const core = tokens.slice(0, -1).join('');
    const coreMatch = core.match(/^(\d+)?([A-Za-z]+)?$/);

    if (!coreMatch) {
      return [];
    }

    const flamsteed = coreMatch[1];
    const greekAbbr = coreMatch[2];
    const candidates: string[] = [];

    if (greekAbbr) {
      const greek = GlobeWiki.STAR_GREEK[greekAbbr];

      if (greek) {
        candidates.push(`${greek}${superscript} ${genitive}`);
      }
    }

    if (flamsteed) {
      candidates.push(`${flamsteed} ${genitive}`);
    }

    return candidates;
  }

  public async loadStarWiki(candidates: string[]): Promise<WikiSummary | null> {
    for (const candidate of candidates) {
      const summary = await this.fetchWikiSummaryOnce(candidate);

      if (summary) {
        return summary;
      }
    }

    return null;
  }

  /** How many images the NASA library has for this query (link shown only
   *  when > 0). */
  public fetchNasaImageHits(query: string): Promise<number> {
    let cached = this.nasaHitsCache.get(query);

    if (!cached) {
      cached = (async () => {
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 4000);

          const response = await fetch(
            'https://images-api.nasa.gov/search?media_type=image&q=' +
              encodeURIComponent(query),
            { signal: controller.signal }
          );

          window.clearTimeout(timeout);

          if (!response.ok) {
            return 0;
          }

          const data = (await response.json()) as {
            collection?: { metadata?: { total_hits?: number } };
          };

          return data.collection?.metadata?.total_hits ?? 0;
        } catch {
          return 0; // Offline / slow / blocked — just no link.
        }
      })();

      this.nasaHitsCache.set(query, cached);
    }

    return cached;
  }

  public fetchCityWiki(city: {
    name: string;
    latDeg: number;
    lonDeg: number;
  }): Promise<WikiSummary | null> {
    const key = `${city.latDeg.toFixed(2)},${city.lonDeg.toFixed(2)}`;
    let cached = this.cityWikiCache.get(key);

    if (!cached) {
      cached = (async () => {
        try {
          const geo = await fetch(
            'https://en.wikipedia.org/w/api.php?action=query&list=geosearch' +
              `&gscoord=${city.latDeg}%7C${city.lonDeg}` +
              '&gsradius=10000&gslimit=50&format=json&origin=*'
          );

          if (!geo.ok) {
            return null;
          }

          const data = (await geo.json()) as {
            query?: { geosearch?: Array<{ title?: string }> };
          };
          const found = data.query?.geosearch ?? [];
          const lowerName = city.name.toLowerCase();

          const nameWords = lowerName.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
          const containedInName = (title: string): boolean => {
            const words = (title.split(',')[0] ?? '')
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter(Boolean);

            if (!words.length) {
              return false;
            }

            for (let i = 0; i + words.length <= nameWords.length; i++) {
              if (words.every((w, j) => nameWords[i + j] === w)) {
                return true;
              }
            }

            return false;
          };
          const score = (title: string): number => {
            const lower = title.toLowerCase();

            if (lower === lowerName) {
              return 0;
            }

            if (lower.startsWith(`${lowerName},`)) {
              return 1;
            }

            if (containedInName(title)) {
              return 1.5;
            }

            if (lower.includes(lowerName)) {
              return 2 + title.length / 1000;
            }

            return 9;
          };

          const ranked = found
            .map((g) => g.title ?? '')
            .filter(Boolean)
            .sort((a, b) => score(a) - score(b));
          const title = ranked[0];

          if (!title || score(title) >= 2) {
            const direct = await this.fetchWikiSummaryOnce(city.name);

            if (direct) {
              return direct;
            }

            const byRelevance = await this.searchWikiCitySummary(
              city.name,
              score
            );

            if (byRelevance) {
              return byRelevance;
            }
          }

          if (!title) {
            return null;
          }

          return await this.fetchWikiSummaryOnce(title);
        } catch {
          return null; // Offline — the card shows our own data only.
        }
      })();

      this.cityWikiCache.set(key, cached);
    }

    return cached;
  }

  /** Place search for the orbit finder. One MediaWiki generator request
   *  returns matching main-namespace pages together with their coordinates;
   *  pages without an Earth coordinate never reach the UI. */
  public async searchEarth(
    query: string,
    signal?: AbortSignal
  ): Promise<EarthSearchResult[]> {
    const term = query.trim();

    if (term.length < 3) {
      return [];
    }

    const response = await fetch(
      'https://en.wikipedia.org/w/api.php?action=query&generator=search' +
        `&gsrsearch=${encodeURIComponent(term)}` +
        '&gsrnamespace=0&gsrlimit=12' +
        '&prop=coordinates&colimit=1&format=json&origin=*',
      { signal }
    );

    if (!response.ok) {
      throw new Error(`wikipedia search ${response.status}`);
    }

    const data = (await response.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            index?: number;
            coordinates?: Array<{
              lat?: number;
              lon?: number;
              globe?: string;
              primary?: string;
            }>;
          }
        >;
      };
    };

    return Object.values(data.query?.pages ?? {})
      .map((page) => {
        const coordinate = (page.coordinates ?? []).find(
          (item) =>
            item.globe === 'earth' &&
            Number.isFinite(item.lat) &&
            Number.isFinite(item.lon)
        );

        if (!page.title || !coordinate) {
          return null;
        }

        return {
          title: page.title,
          latDeg: coordinate.lat!,
          lonDeg: coordinate.lon!,
          index: page.index ?? Number.MAX_SAFE_INTEGER
        };
      })
      .filter(
        (
          item
        ): item is EarthSearchResult & { index: number } => item !== null
      )
      .sort((a, b) => a.index - b.index)
      .slice(0, 8)
      .map(({ title, latDeg, lonDeg }) => ({ title, latDeg, lonDeg }));
  }

  private async searchWikiCitySummary(
    name: string,
    score: (title: string) => number
  ): Promise<WikiSummary | null> {
    try {
      const response = await fetch(
        'https://en.wikipedia.org/w/api.php?action=query&list=search' +
          `&srsearch=${encodeURIComponent(name)}` +
          '&srlimit=8&format=json&origin=*'
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        query?: { search?: Array<{ title?: string }> };
      };
      const hits = data.query?.search ?? [];

      for (const hit of hits) {
        const title = hit.title ?? '';

        if (!title || score(title) >= 2) {
          continue;
        }

        const summary = await this.fetchWikiSummaryOnce(title);

        if (summary) {
          return summary;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
