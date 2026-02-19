import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./PokeDex.css";

interface Pokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  sprites: {
    front_default: string;
    front_shiny?: string;
    other?: { "official-artwork"?: { front_default?: string } };
  };
  types: Array<{ type: { name: string } }>;
  abilities: Array<{ ability: { name: string } }>;
  stats: Array<{ base_stat: number; stat: { name: string } }>;
}

interface PokemonListItem {
  id: number;
  name: string;
}

interface TypeApi {
  name: string;
  damage_relations: {
    double_damage_from: Array<{ name: string }>;
    half_damage_from: Array<{ name: string }>;
    no_damage_from: Array<{ name: string }>;
  };
}

interface EvolutionChain {
  chain: {
    species: { name: string; url: string };
    evolves_to: EvolutionChain["chain"][];
    evolution_details: Array<{
      min_level?: number;
      item?: { name: string; url: string };
      trigger: { name: string };
    }>;
  };
}

interface EvolutionStep {
  id: number;
  name: string;
  requirement?: string;
  stoneImage?: string;
}

const ALL_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

const POKEMON_LIMIT = 1025;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 900;

const GENERATIONS = [
  { id: 1, name: "Kanto", range: [1, 151] },
  { id: 2, name: "Johto", range: [152, 251] },
  { id: 3, name: "Hoenn", range: [252, 386] },
  { id: 4, name: "Sinnoh", range: [387, 493] },
  { id: 5, name: "Unova", range: [494, 649] },
  { id: 6, name: "Kalos", range: [650, 721] },
  { id: 7, name: "Alola", range: [722, 809] },
  { id: 8, name: "Galar", range: [810, 905] },
  { id: 9, name: "Paldea", range: [906, 1025] },
];

type Lang = "pt-BR" | "en";
type Tab = "info" | "stats" | "evolution";

type Effectiveness = {
  weaknesses: string[]; // multipliers > 1
  resistances: string[]; // multipliers < 1 and > 0
  immunities: string[]; // multiplier === 0
};

const LS_KEYS = {
  lang: "pokedex_lang",
  gen: "pokedex_gen",
  fav: "pokedex_favorites",
  favOnly: "pokedex_fav_only",
};

const App: React.FC = () => {
  const [pokemonList, setPokemonList] = useState<PokemonListItem[]>([]);
  const [rawSearch, setRawSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterGeneration, setFilterGeneration] = useState("all");
  const [language, setLanguage] = useState<Lang>("pt-BR");

  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [selectedPokemon, setSelectedPokemon] = useState<Pokemon | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [currentPokemonIndex, setCurrentPokemonIndex] = useState<number | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [pokemonDetailsCache, setPokemonDetailsCache] = useState<Record<number, Pokemon>>({});
  const [evolutionChains, setEvolutionChains] = useState<Record<number, EvolutionStep[]>>({});
  const [typeCache, setTypeCache] = useState<Record<string, TypeApi>>({});
  const [effectiveness, setEffectiveness] = useState<Effectiveness | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);

  const fetchWithRetry = useCallback(async <T,>(url: string, retries = RETRY_ATTEMPTS): Promise<T> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        return (await response.json()) as T;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    throw new Error(`Failed to fetch ${url}`);
  }, []);

  const getListSprite = (id: number) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

  const getPokemonImage = (pokemon: Pokemon) =>
    pokemon.sprites.other?.["official-artwork"]?.front_default ||
    pokemon.sprites.front_default ||
    getListSprite(pokemon.id) ||
    "/placeholder.png";

  const getStatName = (stat: string) => {
    const stats: Record<string, { "pt-BR": string; en: string }> = {
      hp: { "pt-BR": "PS", en: "HP" },
      attack: { "pt-BR": "Ataque", en: "Attack" },
      defense: { "pt-BR": "Defesa", en: "Defense" },
      "special-attack": { "pt-BR": "Ataque Especial", en: "Sp. Attack" },
      "special-defense": { "pt-BR": "Defesa Especial", en: "Sp. Defense" },
      speed: { "pt-BR": "Velocidade", en: "Speed" },
    };
    return stats[stat]?.[language] || stat.replace(/-/g, " ");
  };

  // Persistência
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(LS_KEYS.lang) as Lang | null;
      const savedGen = localStorage.getItem(LS_KEYS.gen);
      const savedFavOnly = localStorage.getItem(LS_KEYS.favOnly);
      const savedFav = localStorage.getItem(LS_KEYS.fav);

      if (savedLang === "pt-BR" || savedLang === "en") setLanguage(savedLang);
      if (savedGen) setFilterGeneration(savedGen);
      if (savedFavOnly) setFavoritesOnly(savedFavOnly === "1");

      if (savedFav) {
        const arr = JSON.parse(savedFav) as number[];
        setFavorites(new Set(arr.filter((n) => typeof n === "number")));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.lang, language);
    } catch {}
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.gen, filterGeneration);
    } catch {}
  }, [filterGeneration]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.favOnly, favoritesOnly ? "1" : "0");
    } catch {}
  }, [favoritesOnly]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.fav, JSON.stringify(Array.from(favorites)));
    } catch {}
  }, [favorites]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(rawSearch.trim()), 180);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Lista leve
  const fetchPokemonList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const listUrl = `https://pokeapi.co/api/v2/pokemon?limit=${POKEMON_LIMIT}`;
      const listData = await fetchWithRetry<{ results: Array<{ name: string; url: string }> }>(listUrl);

      const list: PokemonListItem[] = listData.results.map((r) => {
        const id = parseInt(r.url.split("/").slice(-2, -1)[0], 10);
        return { id, name: r.name };
      });

      list.sort((a, b) => a.id - b.id);
      setPokemonList(list);
      setProgress(100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`${language === "pt-BR" ? "Falha ao carregar a lista" : "Failed to load list"}: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [fetchWithRetry, language]);

  useEffect(() => {
    fetchPokemonList();
  }, [fetchPokemonList]);

  // Busca por número
  const parsedSearch = useMemo(() => {
    const s = debouncedSearch.toLowerCase();
    const onlyDigits = s.replace("#", "").trim();
    const isNum = onlyDigits.length > 0 && /^[0-9]+$/.test(onlyDigits);
    const num = isNum ? parseInt(onlyDigits, 10) : null;
    return { s, isNum, num };
  }, [debouncedSearch]);

  const filteredPokemon = useMemo(() => {
    return pokemonList.filter((p) => {
      const matchesGen =
        filterGeneration === "all" ||
        GENERATIONS.some(
          (gen) =>
            gen.id.toString() === filterGeneration.replace("gen", "") &&
            p.id >= gen.range[0] &&
            p.id <= gen.range[1]
        );

      const matchesFav = !favoritesOnly || favorites.has(p.id);

      const matchesSearch = (() => {
        if (!parsedSearch.s) return true;
        if (parsedSearch.isNum && parsedSearch.num !== null) return p.id === parsedSearch.num;
        return p.name.toLowerCase().includes(parsedSearch.s);
      })();

      return matchesGen && matchesFav && matchesSearch;
    });
  }, [pokemonList, filterGeneration, favoritesOnly, favorites, parsedSearch]);

  const groupedPokemon = useMemo(() => {
    const groups = GENERATIONS.map((gen) => ({ ...gen, pokemon: [] as PokemonListItem[] }));
    filteredPokemon.forEach((p) => {
      const g = groups.find((x) => p.id >= x.range[0] && p.id <= x.range[1]);
      if (g) g.pokemon.push(p);
    });
    return groups.filter((g) => g.pokemon.length > 0);
  }, [filteredPokemon]);

  const loadPokemonDetails = useCallback(
    async (id: number) => {
      if (pokemonDetailsCache[id]) return pokemonDetailsCache[id];
      const data = await fetchWithRetry<Pokemon>(`https://pokeapi.co/api/v2/pokemon/${id}`);
      setPokemonDetailsCache((prev) => ({ ...prev, [id]: data }));
      return data;
    },
    [fetchWithRetry, pokemonDetailsCache]
  );

  const preloadNeighbors = useCallback(
    async (index: number) => {
      const prevIndex = index > 0 ? index - 1 : pokemonList.length - 1;
      const nextIndex = index < pokemonList.length - 1 ? index + 1 : 0;
      const prev = pokemonList[prevIndex];
      const next = pokemonList[nextIndex];
      if (prev) loadPokemonDetails(prev.id).catch(() => {});
      if (next) loadPokemonDetails(next.id).catch(() => {});
    },
    [loadPokemonDetails, pokemonList]
  );

  const openPokemonByIndex = useCallback(
    async (index: number) => {
      const item = pokemonList[index];
      if (!item) return;

      setCurrentPokemonIndex(index);
      setSelectedLoading(true);
      setSelectedPokemon(null);
      setActiveTab("info");
      setEffectiveness(null);

      try {
        const details = await loadPokemonDetails(item.id);
        setSelectedPokemon(details);
        preloadNeighbors(index);
      } finally {
        setSelectedLoading(false);
      }
    },
    [loadPokemonDetails, pokemonList, preloadNeighbors]
  );

  const handlePokemonSelect = useCallback(
    async (pokemon: PokemonListItem) => {
      const index = pokemonList.findIndex((p) => p.id === pokemon.id);
      if (index === -1) return;
      await openPokemonByIndex(index);
    },
    [openPokemonByIndex, pokemonList]
  );

  const handlePokemonNavigation = useCallback(
    async (direction: "prev" | "next") => {
      if (currentPokemonIndex === null || pokemonList.length === 0) return;

      const newIndex =
        direction === "prev"
          ? currentPokemonIndex > 0
            ? currentPokemonIndex - 1
            : pokemonList.length - 1
          : currentPokemonIndex < pokemonList.length - 1
          ? currentPokemonIndex + 1
          : 0;

      await openPokemonByIndex(newIndex);
    },
    [currentPokemonIndex, openPokemonByIndex, pokemonList.length]
  );

  const closeModal = useCallback(() => {
    setSelectedPokemon(null);
    setActiveTab("info");
    setCurrentPokemonIndex(null);
    setEffectiveness(null);
  }, []);

  // Trava scroll do fundo quando modal abre
  useEffect(() => {
    if (selectedPokemon || selectedLoading) document.body.classList.add("modal-open");
    else document.body.classList.remove("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [selectedPokemon, selectedLoading]);

  // Teclado no modal
  useEffect(() => {
    if (!selectedPokemon && !selectedLoading) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowLeft") handlePokemonNavigation("prev");
      if (e.key === "ArrowRight") handlePokemonNavigation("next");
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPokemon, selectedLoading, closeModal, handlePokemonNavigation]);

  // Foca modal quando abre
  useEffect(() => {
    if ((selectedPokemon || selectedLoading) && modalRef.current) {
      modalRef.current.focus();
    }
  }, [selectedPokemon, selectedLoading]);

  // Evolução sob demanda
  const mapItemToName = useCallback((itemName: string, lang: Lang) => {
    const items: Record<string, { "pt-BR": string; en: string }> = {
      "fire-stone": { "pt-BR": "Pedra de Fogo", en: "Fire Stone" },
      "water-stone": { "pt-BR": "Pedra de Água", en: "Water Stone" },
      "thunder-stone": { "pt-BR": "Pedra de Trovão", en: "Thunder Stone" },
      "leaf-stone": { "pt-BR": "Pedra de Folha", en: "Leaf Stone" },
      "moon-stone": { "pt-BR": "Pedra da Lua", en: "Moon Stone" },
      "sun-stone": { "pt-BR": "Pedra do Sol", en: "Sun Stone" },
      "shiny-stone": { "pt-BR": "Pedra Brilhante", en: "Shiny Stone" },
      "dusk-stone": { "pt-BR": "Pedra do Crepúsculo", en: "Dusk Stone" },
      "dawn-stone": { "pt-BR": "Pedra da Alvorada", en: "Dawn Stone" },
    };
    return items[itemName]?.[lang] || itemName.replace(/-/g, " ");
  }, []);

  const extractEvolutionChainSteps = useCallback(
    (evolutionData: EvolutionChain, list: PokemonListItem[]): EvolutionStep[] => {
      const steps: EvolutionStep[] = [];

      const traverse = (chain: EvolutionChain["chain"]) => {
        const id = parseInt(chain.species.url.split("/").slice(-2, -1)[0], 10);
        const name = list.find((p) => p.id === id)?.name || chain.species.name;

        let requirement: string | undefined;
        let stoneImage: string | undefined;

        if (chain.evolution_details.length > 0) {
          const d = chain.evolution_details[0];
          if (d.min_level) {
            requirement = `${language === "pt-BR" ? "Nv." : "Lv."} ${d.min_level}`;
          } else if (d.item) {
            const itemName = d.item.name;
            const imgs: Record<string, string> = {
              "fire-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/fire-stone.png",
              "water-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/water-stone.png",
              "thunder-stone":
                "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/thunder-stone.png",
              "leaf-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/leaf-stone.png",
              "moon-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png",
              "sun-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/sun-stone.png",
              "shiny-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/shiny-stone.png",
              "dusk-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/dusk-stone.png",
              "dawn-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/dawn-stone.png",
            };
            stoneImage = imgs[itemName];
            requirement = mapItemToName(itemName, language);
          } else if (d.trigger.name === "trade") {
            requirement = language === "pt-BR" ? "Troca" : "Trade";
          }
        }

        steps.push({ id, name, requirement, stoneImage });
        chain.evolves_to.forEach(traverse);
      };

      traverse(evolutionData.chain);
      return steps;
    },
    [language, mapItemToName]
  );

  const loadEvolutionForPokemon = useCallback(
    async (id: number) => {
      if (evolutionChains[id]) return;

      const species = await fetchWithRetry<{ evolution_chain: { url: string } }>(
        `https://pokeapi.co/api/v2/pokemon-species/${id}`
      );
      const evoData = await fetchWithRetry<EvolutionChain>(species.evolution_chain.url);
      const steps = extractEvolutionChainSteps(evoData, pokemonList);

      setEvolutionChains((prev) => {
        const next = { ...prev };
        steps.forEach((s) => (next[s.id] = steps));
        return next;
      });
    },
    [evolutionChains, extractEvolutionChainSteps, fetchWithRetry, pokemonList]
  );

  useEffect(() => {
    if (activeTab === "evolution" && selectedPokemon) {
      loadEvolutionForPokemon(selectedPokemon.id).catch(() => {});
    }
  }, [activeTab, selectedPokemon, loadEvolutionForPokemon]);

  // Efetividade real via PokeAPI type
  const loadType = useCallback(
    async (typeName: string) => {
      if (typeCache[typeName]) return typeCache[typeName];
      const t = await fetchWithRetry<TypeApi>(`https://pokeapi.co/api/v2/type/${typeName}`);
      setTypeCache((prev) => ({ ...prev, [typeName]: t }));
      return t;
    },
    [fetchWithRetry, typeCache]
  );

  const computeEffectiveness = useCallback(
    async (pokemon: Pokemon) => {
      const pokemonTypes = pokemon.types.map((t) => t.type.name.toLowerCase());
      const mult: Record<string, number> = {};
      ALL_TYPES.forEach((t) => (mult[t] = 1));

      const typeDatas = await Promise.all(pokemonTypes.map((t) => loadType(t)));

      for (const td of typeDatas) {
        td.damage_relations.double_damage_from.forEach((x) => (mult[x.name] *= 2));
        td.damage_relations.half_damage_from.forEach((x) => (mult[x.name] *= 0.5));
        td.damage_relations.no_damage_from.forEach((x) => (mult[x.name] = 0));
      }

      const weaknesses: string[] = [];
      const resistances: string[] = [];
      const immunities: string[] = [];

      ALL_TYPES.forEach((t) => {
        const v = mult[t];
        if (v === 0) immunities.push(t);
        else if (v > 1) weaknesses.push(t);
        else if (v < 1) resistances.push(t);
      });

      setEffectiveness({ weaknesses, resistances, immunities });
    },
    [loadType]
  );

  useEffect(() => {
    if (!selectedPokemon) return;
    computeEffectiveness(selectedPokemon).catch(() => setEffectiveness(null));
  }, [selectedPokemon, computeEffectiveness]);

  return (
    <div className="pokedex-container">
      <h1>Pokédex</h1>

      <div className="controls">
        <select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
          <option value="pt-BR">Português</option>
          <option value="en">English</option>
        </select>

        <select value={filterGeneration} onChange={(e) => setFilterGeneration(e.target.value)}>
          <option value="all">{language === "pt-BR" ? "Todas Gerações" : "All Generations"}</option>
          {GENERATIONS.map((gen) => (
            <option key={gen.id} value={`gen${gen.id}`}>
              {`Gen ${gen.id} (${gen.name})`}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={rawSearch}
          onChange={(e) => setRawSearch(e.target.value)}
          placeholder={language === "pt-BR" ? "Buscar por nome ou número" : "Search by name or number"}
        />

        <button
          type="button"
          className={`fav-filter ${favoritesOnly ? "fav-filter-on" : ""}`}
          onClick={() => setFavoritesOnly((v) => !v)}
          title={language === "pt-BR" ? "Mostrar apenas favoritos" : "Show favorites only"}
        >
          ★ {language === "pt-BR" ? "Favoritos" : "Favorites"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="loading">{language === "pt-BR" ? `Carregando ${progress}%` : `Loading ${progress}%`}</div>
      ) : (
        <div className="pokemon-groups">
          {groupedPokemon.map((group) => (
            <div key={group.id} className="pokemon-group">
              <h2>{`${language === "pt-BR" ? "Geração" : "Generation"} ${group.id}  ${group.name}`}</h2>

              <div className="pokemon-grid">
                {group.pokemon.map((pokemon) => (
                  <div key={pokemon.id} className="pokemon-card-wrap">
                    <button className="pokemon-card" onClick={() => handlePokemonSelect(pokemon)} type="button">
                      <img
                        src={getListSprite(pokemon.id)}
                        alt={pokemon.name}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/placeholder.png";
                        }}
                      />
                      <div className="pokemon-card-info">
                        <p className="pokemon-id">#{pokemon.id.toString().padStart(3, "0")}</p>
                        <h3>{pokemon.name}</h3>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`fav-star ${favorites.has(pokemon.id) ? "fav-star-on" : ""}`}
                      onClick={() => toggleFavorite(pokemon.id)}
                      aria-label="favorite"
                      title={language === "pt-BR" ? "Favoritar" : "Favorite"}
                    >
                      ★
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(selectedPokemon || selectedLoading) && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
          >
            <button className="close-x" onClick={closeModal} aria-label="close">
              ×
            </button>

            {selectedLoading || !selectedPokemon ? (
              <div className="loading">{language === "pt-BR" ? "Carregando detalhes" : "Loading details"}</div>
            ) : (
              <>
                <h2 className="modal-title">
                  #{selectedPokemon.id.toString().padStart(3, "0")} {selectedPokemon.name}
                </h2>

                <div className="tabs">
                  <button className={activeTab === "info" ? "tab-active" : ""} onClick={() => setActiveTab("info")}>
                    {language === "pt-BR" ? "Informações" : "Information"}
                  </button>
                  <button className={activeTab === "stats" ? "tab-active" : ""} onClick={() => setActiveTab("stats")}>
                    {language === "pt-BR" ? "Estatísticas" : "Stats"}
                  </button>
                  <button
                    className={activeTab === "evolution" ? "tab-active" : ""}
                    onClick={() => setActiveTab("evolution")}
                  >
                    {language === "pt-BR" ? "Evolução" : "Evolution"}
                  </button>
                </div>

                {activeTab === "info" && (
                  <div className="tab-content">
                    <img className="pokemon-detail-image" src={getPokemonImage(selectedPokemon)} alt={selectedPokemon.name} />

                    <div className="section">
                      <h3>{language === "pt-BR" ? "Tipo" : "Type"}</h3>
                      <div className="types">
                        {selectedPokemon.types.map((t) => (
                          <span key={t.type.name} className={`type-badge type-${t.type.name}`}>
                            {t.type.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="section">
                      <h3>{language === "pt-BR" ? "Fraquezas" : "Weaknesses"}</h3>
                      <div className="effectiveness">
                        {effectiveness ? (
                          <>
                            {effectiveness.weaknesses.map((t) => (
                              <span key={`wk-${t}`} className={`type-badge type-${t}`}>
                                {t}
                              </span>
                            ))}
                            {effectiveness.weaknesses.length === 0 && (
                              <span className="muted">{language === "pt-BR" ? "Nenhuma" : "None"}</span>
                            )}
                          </>
                        ) : (
                          <span className="muted">{language === "pt-BR" ? "Carregando" : "Loading"}</span>
                        )}
                      </div>
                    </div>

                    <div className="section">
                      <h3>{language === "pt-BR" ? "Resistências" : "Resistances"}</h3>
                      <div className="effectiveness">
                        {effectiveness ? (
                          <>
                            {effectiveness.resistances.map((t) => (
                              <span key={`rs-${t}`} className={`type-badge type-${t}`}>
                                {t}
                              </span>
                            ))}
                            {effectiveness.resistances.length === 0 && (
                              <span className="muted">{language === "pt-BR" ? "Nenhuma" : "None"}</span>
                            )}
                          </>
                        ) : (
                          <span className="muted">{language === "pt-BR" ? "Carregando" : "Loading"}</span>
                        )}
                      </div>
                    </div>

                    <div className="section">
                      <h3>{language === "pt-BR" ? "Imunidades" : "Immunities"}</h3>
                      <div className="effectiveness">
                        {effectiveness ? (
                          <>
                            {effectiveness.immunities.map((t) => (
                              <span key={`im-${t}`} className={`type-badge type-${t}`}>
                                {t}
                              </span>
                            ))}
                            {effectiveness.immunities.length === 0 && (
                              <span className="muted">{language === "pt-BR" ? "Nenhuma" : "None"}</span>
                            )}
                          </>
                        ) : (
                          <span className="muted">{language === "pt-BR" ? "Carregando" : "Loading"}</span>
                        )}
                      </div>
                    </div>

                    <div className="section">
                      <h3>{language === "pt-BR" ? "Detalhes" : "Details"}</h3>
                      <p>
                        {language === "pt-BR" ? "Altura" : "Height"}: {(selectedPokemon.height / 10).toFixed(1)} m
                      </p>
                      <p>
                        {language === "pt-BR" ? "Peso" : "Weight"}: {(selectedPokemon.weight / 10).toFixed(1)} kg
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === "stats" && (
                  <div className="tab-content">
                    <div className="stats-list">
                      {selectedPokemon.stats.map((stat) => {
                        const value = stat.base_stat;
                        const pct = Math.min(100, Math.round((value / 200) * 100));
                        return (
                          <div key={stat.stat.name} className="stat-row">
                            <span className="stat-name">{getStatName(stat.stat.name)}</span>
                            <div className="stat-bar">
                              <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="stat-value">{value}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "evolution" && (
                  <div className="tab-content">
                    {evolutionChains[selectedPokemon.id] ? (
                      <div className="evolution-chain">
                        {evolutionChains[selectedPokemon.id].map((step, index) => {
                          const pokemon = pokemonList.find((p) => p.id === step.id);
                          if (!pokemon) return null;

                          return (
                            <div key={step.id} className="evolution-step">
                              {index > 0 && (
                                <div className="evolution-requirement">
                                  {step.stoneImage ? (
                                    <img src={step.stoneImage} alt={step.requirement} title={step.requirement} />
                                  ) : (
                                    <span className="evo-req-text">{step.requirement || "?"}</span>
                                  )}
                                  <span className="arrow">→</span>
                                </div>
                              )}

                              <button type="button" className="evo-pokemon" onClick={() => handlePokemonSelect(pokemon)}>
                                <img
                                  className="evo-sprite"
                                  src={getListSprite(pokemon.id)}
                                  alt={pokemon.name}
                                  loading="lazy"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = "/placeholder.png";
                                  }}
                                />
                                <span>
                                  #{pokemon.id.toString().padStart(3, "0")} {pokemon.name}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="loading">{language === "pt-BR" ? "Carregando evolução" : "Loading evolution"}</div>
                    )}
                  </div>
                )}

                <div className="navigation-buttons">
                  <button onClick={() => handlePokemonNavigation("prev")}>{language === "pt-BR" ? "Anterior" : "Previous"}</button>
                  <button onClick={() => handlePokemonNavigation("next")}>{language === "pt-BR" ? "Próximo" : "Next"}</button>
                </div>

                <p className="modal-hint">
                  {language === "pt-BR"
                    ? "Dica: use Esc para fechar e as setas para navegar"
                    : "Tip: use Esc to close and arrows to navigate"}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
