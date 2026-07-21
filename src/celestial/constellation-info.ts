// Short descriptive info for the prominent (rank 1-2) constellations.
// Shown in the constellation hover tooltip. Brightest star is computed at
// runtime from the star catalog, so it is not duplicated here.

export type ConstellationInfo = {
  meaning: string; // what the figure represents
  season: string;  // best viewing (Northern-hemisphere evening unless noted)
};

export const CONSTELLATION_INFO: Record<string, ConstellationInfo> = {
  And: { meaning: 'The chained princess of Greek myth.', season: 'Autumn (N)' },
  Aqr: { meaning: 'The water-bearer; a zodiac constellation.', season: 'Autumn (N)' },
  Aql: { meaning: 'The eagle of Zeus; holds bright Altair.', season: 'Summer (N)' },
  Ari: { meaning: 'The ram of the golden fleece; zodiac.', season: 'Autumn (N)' },
  Aur: { meaning: 'The charioteer; holds brilliant Capella.', season: 'Winter (N)' },
  Boo: { meaning: 'The herdsman; home of orange Arcturus.', season: 'Spring (N)' },
  Cam: { meaning: 'The giraffe; faint and sprawling near the pole.', season: 'Circumpolar (N)' },
  Cnc: { meaning: 'The crab; faintest zodiac, holds the Beehive cluster.', season: 'Spring (N)' },
  CVn: { meaning: 'The hunting dogs of Bootes.', season: 'Spring (N)' },
  CMa: { meaning: 'The great dog; home of Sirius, the brightest star.', season: 'Winter (N)' },
  CMi: { meaning: 'The little dog; marked by bright Procyon.', season: 'Winter (N)' },
  Cap: { meaning: 'The sea-goat; an ancient zodiac sign.', season: 'Late summer (N)' },
  Car: { meaning: 'The keel of the ship Argo; holds Canopus.', season: 'Southern sky' },
  Cas: { meaning: 'The vain queen; an unmistakable "W".', season: 'Autumn (N), circumpolar' },
  Cen: { meaning: 'The centaur; holds Alpha Centauri, the nearest star system.', season: 'Southern sky' },
  Cep: { meaning: 'The king; a house-shaped figure near the pole.', season: 'Autumn (N), circumpolar' },
  Cet: { meaning: 'The sea monster; contains the variable star Mira.', season: 'Autumn (N)' },
  CrB: { meaning: 'The northern crown; a graceful arc of stars.', season: 'Summer (N)' },
  Cru: { meaning: 'The Southern Cross; the smallest constellation.', season: 'Southern sky' },
  Cyg: { meaning: 'The swan; the Northern Cross along the Milky Way.', season: 'Summer (N)' },
  Dra: { meaning: 'The dragon winding around the north pole.', season: 'Summer (N), circumpolar' },
  Eri: { meaning: 'The celestial river; ends at bright Achernar.', season: 'Winter (N)' },
  Gem: { meaning: 'The twins Castor and Pollux; zodiac.', season: 'Winter (N)' },
  Her: { meaning: 'The hero; holds the great globular cluster M13.', season: 'Summer (N)' },
  Hya: { meaning: 'The water snake; the largest constellation.', season: 'Spring (N)' },
  Leo: { meaning: 'The lion; its "Sickle" forms the head, with Regulus.', season: 'Spring (N)' },
  Lib: { meaning: 'The scales; the only inanimate zodiac sign.', season: 'Summer (N)' },
  Lyr: { meaning: 'The lyre; small but holds brilliant Vega.', season: 'Summer (N)' },
  Mon: { meaning: 'The unicorn; faint, set in the winter Milky Way.', season: 'Winter (N)' },
  Oph: { meaning: 'The serpent-bearer; the 13th zodiac constellation.', season: 'Summer (N)' },
  Ori: { meaning: 'The hunter; the most recognizable constellation, with the Belt.', season: 'Winter (N)' },
  Pav: { meaning: 'The peacock; a southern bird constellation.', season: 'Southern sky' },
  Peg: { meaning: 'The winged horse; marked by the Great Square.', season: 'Autumn (N)' },
  Per: { meaning: 'The hero who slew Medusa; holds variable Algol.', season: 'Autumn/Winter (N)' },
  Phe: { meaning: 'The firebird; a southern constellation.', season: 'Southern sky' },
  Psc: { meaning: 'The two fishes tied by a cord; zodiac.', season: 'Autumn (N)' },
  PsA: { meaning: 'The southern fish; holds lonely Fomalhaut.', season: 'Autumn (N)' },
  Pup: { meaning: 'The stern of the ship Argo Navis.', season: 'Winter (N) / southern' },
  Sgr: { meaning: 'The archer; aims at the center of the Milky Way.', season: 'Summer (N)' },
  Sco: { meaning: 'The scorpion; a bright hook of stars around red Antares.', season: 'Summer (N)' },
  Tau: { meaning: 'The bull; holds the Pleiades and Hyades clusters.', season: 'Winter (N)' },
  TrA: { meaning: 'The southern triangle.', season: 'Southern sky' },
  UMa: { meaning: 'The great bear; contains the Big Dipper.', season: 'Spring (N), circumpolar' },
  UMi: { meaning: 'The little bear; its tail tip is Polaris, the North Star.', season: 'Circumpolar (N)' },
  Vel: { meaning: 'The sails of the ship Argo Navis.', season: 'Southern sky' },
  Vir: { meaning: 'The maiden; second-largest constellation, with Spica.', season: 'Spring (N)' }
};
