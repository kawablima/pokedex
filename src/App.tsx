import React, { useEffect, useState, useCallback, useMemo } from "react";
import "./PokeDex.css";

// Interfaces (detalhe completo vindo de /pokemon/{id})
interface Pokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  sprites: {
    front_default: string;
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

// Constantes
const POKEMON_LIMIT = 1025;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

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

const App: React.FC = () => {
  // Estados
  const [pokemonList, setPokemonList] = useState<PokemonListItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPokemon, setSelectedPokemon] = useState<Pokemon | null>(null);
  const [filterGeneration, setFilterGeneration] = useState("all");
  const [activeTab, setActiveTab] = useState("info");
  const [currentPokemonIndex, setCurrentPokemonIndex] = useState<number | null>(null);
  const [language, setLanguage] = useState<"pt-BR" | "en">("pt-BR");

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [selectedLoading, setSelectedLoading] = useState(false);

  // Cache de detalhes e evolução
  const [pokemonDetailsCache, setPokemonDetailsCache] = useState<Record<number, Pokemon>>({});
  const [evolutionChains, setEvolutionChains] = useState<Record<number, EvolutionStep[]>>({});

  // Função para buscar dados com retry
  const fetchWithRetry = useCallback(
    async <T,>(url: string, retries = RETRY_ATTEMPTS): Promise<T> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return (await response.json()) as T;
        } catch (err) {
          if (attempt === retries) throw err;
          console.warn(`Attempt ${attempt} failed for ${url}. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
      throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
    },
    []
  );

  // Mapeia itens para nomes legíveis
  const mapItemToName = useCallback((itemName: string, lang: "pt-BR" | "en") => {
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
    return items[itemName]?.[lang] || itemName.replace("-", " ");
  }, []);

  // Extrai passos da cadeia evolutiva
  const extractEvolutionChainSteps = useCallback(
    (evolutionData: EvolutionChain, list: PokemonListItem[]): EvolutionStep[] => {
      const steps: EvolutionStep[] = [];

      const traverseChain = (chain: EvolutionChain["chain"]) => {
        const speciesUrl = chain.species.url;
        const id = parseInt(speciesUrl.split("/").slice(-2, -1)[0], 10);
        const name = list.find((p) => p.id === id)?.name || chain.species.name;

        let requirement: string | undefined;
        let stoneImage: string | undefined;

        if (chain.evolution_details.length > 0) {
          const details = chain.evolution_details[0];

          if (details.min_level) {
            requirement = `Lv. ${details.min_level}`;
          } else if (details.item) {
            const itemName = details.item.name;
            const stoneImages: Record<string, string> = {
              "fire-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/fire-stone.png",
              "water-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/water-stone.png",
              "thunder-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/thunder-stone.png",
              "leaf-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/leaf-stone.png",
              "moon-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png",
              "sun-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/sun-stone.png",
              "shiny-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/shiny-stone.png",
              "dusk-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/dusk-stone.png",
              "dawn-stone": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/dawn-stone.png",
            };
            stoneImage = stoneImages[itemName];
            requirement = mapItemToName(itemName, language);
          } else if (details.trigger.name === "trade") {
            requirement = language === "pt-BR" ? "Trocar" : "Trade";
          }
        }

        steps.push({ id, name, requirement, stoneImage });
        chain.evolves_to.forEach(traverseChain);
      };

      traverseChain(evolutionData.chain);
      return steps;
    },
    [language, mapItemToName]
  );

  // Busca lista leve (1 request)
  const fetchPokemonList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const listUrl = `https://pokeapi.co/api/v2/pokemon?limit=${POKEMON_LIMIT}`;
      const listData = await fetchWithRetry<{
        results: Array<{ name: string; url: string }>;
      }>(listUrl);

      const list: PokemonListItem[] = listData.results.map((r) => {
        const id = parseInt(r.url.split("/").slice(-2, -1)[0], 10);
        return { id, name: r.name };
      });

      list.sort((a, b) => a.id - b.id);
      setPokemonList(list);
      setProgress(100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load Pokémon list: ${msg}. Please try again later.`);
      console.error("Error loading Pokémon list:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchWithRetry]);

  // Busca detalhe sob demanda com cache
  const loadPokemonDetails = useCallback(
    async (id: number) => {
      if (pokemonDetailsCache[id]) return pokemonDetailsCache[id];

      const data = await fetchWithRetry<Pokemon>(`https://pokeapi.co/api/v2/pokemon/${id}`);
      setPokemonDetailsCache((prev) => ({ ...prev, [id]: data }));
      return data;
    },
    [fetchWithRetry, pokemonDetailsCache]
  );

  // Carrega evolução sob demanda (somente quando aba "evolution" abrir)
  const loadEvolutionForPokemon = useCallback(
    async (id: number) => {
      if (evolutionChains[id]) return;

      try {
        const speciesData = await fetchWithRetry<{
          evolution_chain: { url: string };
        }>(`https://pokeapi.co/api/v2/pokemon-species/${id}`);

        const evolutionData = await fetchWithRetry<EvolutionChain>(speciesData.evolution_chain.url);
        const chainSteps = extractEvolutionChainSteps(evolutionData, pokemonList);

        // mapeia a mesma chain para todos os ids dela (mantém seu modelo atual de leitura)
        setEvolutionChains((prev) => {
          const next = { ...prev };
          chainSteps.forEach((step) => {
            next[step.id] = chainSteps;
          });
          return next;
        });
      } catch (err) {
        console.warn(`Failed to load evolution chain for Pokémon ${id}:`, err);
      }
    },
    [evolutionChains, extractEvolutionChainSteps, fetchWithRetry, pokemonList]
  );

  // Efeito inicial
  useEffect(() => {
    fetchPokemonList();
  }, [fetchPokemonList]);

  // Filtra Pokémon por termo de busca e geração
  const filteredPokemon = useMemo(() => {
    return pokemonList.filter((pokemon) => {
      const matchesSearch = pokemon.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesGeneration =
        filterGeneration === "all" ||
        GENERATIONS.some(
          (gen) =>
            gen.id.toString() === filterGeneration.replace("gen", "") &&
            pokemon.id >= gen.range[0] &&
            pokemon.id <= gen.range[1]
        );

      return matchesSearch && matchesGeneration;
    });
  }, [pokemonList, searchTerm, filterGeneration]);

  // Agrupa Pokémon por geração
  const groupedPokemon = useMemo(() => {
    const groups = GENERATIONS.map((gen) => ({ ...gen, pokemon: [] as PokemonListItem[] }));
    filteredPokemon.forEach((pokemon) => {
      const group = groups.find((g) => pokemon.id >= g.range[0] && pokemon.id <= g.range[1]);
      if (group) group.pokemon.push(pokemon);
    });
    return groups.filter((group) => group.pokemon.length > 0);
  }, [filteredPokemon]);

  // Handlers
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value);
  const handleGenerationFilter = (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilterGeneration(e.target.value);

  const openPokemonByIndex = useCallback(
    async (index: number) => {
      const item = pokemonList[index];
      if (!item) return;

      setCurrentPokemonIndex(index);
      setSelectedLoading(true);
      setSelectedPokemon(null);

      try {
        const details = await loadPokemonDetails(item.id);
        setSelectedPokemon(details);
      } catch (err) {
        console.error("Error loading Pokémon details:", err);
      } finally {
        setSelectedLoading(false);
      }
    },
    [loadPokemonDetails, pokemonList]
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

  const closeModal = () => {
    setSelectedPokemon(null);
    setActiveTab("info");
    setCurrentPokemonIndex(null);
  };

  // Ao abrir a aba de evolução, carrega só a chain do selecionado
  useEffect(() => {
    if (activeTab === "evolution" && selectedPokemon) {
      loadEvolutionForPokemon(selectedPokemon.id);
    }
  }, [activeTab, selectedPokemon, loadEvolutionForPokemon]);

  // Funções auxiliares
  const getPokemonImageFromId = (id: number) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

  const getPokemonImage = (pokemon: Pokemon) => {
    return (
      pokemon.sprites.other?.["official-artwork"]?.front_default ||
      pokemon.sprites.front_default ||
      getPokemonImageFromId(pokemon.id) ||
      "/placeholder.png"
    );
  };

  const getStatName = (stat: string) => {
    const stats: Record<string, { "pt-BR": string; en: string }> = {
      hp: { "pt-BR": "PS", en: "HP" },
      attack: { "pt-BR": "Ataque", en: "Attack" },
      defense: { "pt-BR": "Defesa", en: "Defense" },
      "special-attack": { "pt-BR": "Ataque Especial", en: "Sp. Attack" },
      "special-defense": { "pt-BR": "Defesa Especial", en: "Sp. Defense" },
      speed: { "pt-BR": "Velocidade", en: "Speed" },
    };
    return stats[stat]?.[language] || stat;
  };

  // Type effectiveness (mantido igual, só usado no modal)
  const getTypeEffectiveness = (types: Pokemon["types"]) => {
    const typeEffectiveness: {
      [key: string]: { strongAgainst: string[]; weakAgainst: string[] };
    } = {
      normal: { strongAgainst: [], weakAgainst: ["rock", "steel"] },
      fire: { strongAgainst: ["grass", "ice", "bug", "steel"], weakAgainst: ["water", "rock", "fire"] },
      water: { strongAgainst: ["fire", "ground", "rock"], weakAgainst: ["grass", "electric"] },
      grass: { strongAgainst: ["water", "ground", "rock"], weakAgainst: ["fire", "flying", "poison", "bug"] },
      electric: { strongAgainst: ["water", "flying"], weakAgainst: ["grass", "electric", "dragon"] },
      ice: { strongAgainst: ["grass", "ground", "flying", "dragon"], weakAgainst: ["fire", "water", "ice", "steel"] },
      fighting: { strongAgainst: ["normal", "rock", "steel", "ice", "dark"], weakAgainst: ["flying", "psychic", "fairy"] },
      poison: { strongAgainst: ["grass", "fairy"], weakAgainst: ["ground", "psychic"] },
      ground: { strongAgainst: ["fire", "electric", "rock", "steel"], weakAgainst: ["grass", "water"] },
      flying: { strongAgainst: ["grass", "fighting", "bug"], weakAgainst: ["rock", "electric", "ice"] },
      psychic: { strongAgainst: ["fighting", "poison"], weakAgainst: ["bug", "ghost", "dark"] },
      bug: { strongAgainst: ["grass", "psychic", "dark"], weakAgainst: ["fire", "flying", "rock"] },
      rock: { strongAgainst: ["fire", "ice", "flying", "bug"], weakAgainst: ["water", "grass"] },
      ghost: { strongAgainst: ["psychic", "ghost"], weakAgainst: ["dark"] },
      dragon: { strongAgainst: ["dragon"], weakAgainst: ["ice", "fairy"] },
      dark: { strongAgainst: ["psychic", "ghost"], weakAgainst: ["fighting", "fairy"] },
      steel: { strongAgainst: ["ice", "rock", "fairy"], weakAgainst: ["fire", "water", "electric"] },
      fairy: { strongAgainst: ["fighting", "dragon", "dark"], weakAgainst: ["steel", "poison"] },
    };

    let strongAgainst: string[] = [];
    let weakAgainst: string[] = [];

    types.forEach((type) => {
      const typeName = type.type.name.toLowerCase();
      if (typeEffectiveness[typeName]) {
        strongAgainst = Array.from(new Set([...strongAgainst, ...typeEffectiveness[typeName].strongAgainst]));
        weakAgainst = Array.from(new Set([...weakAgainst, ...typeEffectiveness[typeName].weakAgainst]));
      }
    });

    return { strongAgainst, weakAgainst };
  };

  // Renderização
  return (
    <div className="pokedex-container">
      {/* Cabeçalho e controles */}
      <h1>{language === "pt-BR" ? "Pokédex" : "Pokédex"}</h1>

      <div className="controls">
        <select value={language} onChange={(e) => setLanguage(e.target.value as "pt-BR" | "en")}>
          <option value="pt-BR">Português</option>
          <option value="en">English</option>
        </select>

        <select value={filterGeneration} onChange={handleGenerationFilter}>
          <option value="all">{language === "pt-BR" ? "Todas Gerações" : "All Generations"}</option>
          {GENERATIONS.map((gen) => (
            <option key={gen.id} value={`gen${gen.id}`}>
              {language === "pt-BR" ? `Gen ${gen.id} (${gen.name})` : `Gen ${gen.id} (${gen.name})`}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={searchTerm}
          onChange={handleSearch}
          placeholder={language === "pt-BR" ? "Buscar Pokémon..." : "Search Pokémon..."}
        />
      </div>

      {/* Conteúdo principal */}
      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="loading">{language === "pt-BR" ? `Carregando... ${progress}%` : `Loading... ${progress}%`}</div>
      ) : (
        <div className="pokemon-groups">
          {groupedPokemon.map((group) => (
            <div key={group.id} className="pokemon-group">
              <h2>
                {`${language === "pt-BR" ? "Geração" : "Generation"} ${group.id} - ${group.name}`}
              </h2>

              <div className="pokemon-grid">
                {group.pokemon.map((pokemon) => (
                  <button
                    key={pokemon.id}
                    className="pokemon-card"
                    onClick={() => handlePokemonSelect(pokemon)}
                    type="button"
                  >
                    <img
                      src={getPokemonImageFromId(pokemon.id)}
                      alt={pokemon.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/placeholder.png";
                      }}
                    />
                    <div className="pokemon-card-info">
                      <p className="pokemon-id">#{pokemon.id.toString().padStart(3, "0")}</p>
                      <h3>{pokemon.name}</h3>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de detalhes */}
      {(selectedPokemon || selectedLoading) && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {selectedLoading || !selectedPokemon ? (
              <div className="loading">{language === "pt-BR" ? "Carregando detalhes..." : "Loading details..."}</div>
            ) : (
              <>
                <h2>
                  #{selectedPokemon.id.toString().padStart(3, "0")} {selectedPokemon.name}
                </h2>

                <button className="close-modal" onClick={closeModal}>
                  ×
                </button>

                <div className="tabs">
                  <button onClick={() => setActiveTab("info")}>
                    {language === "pt-BR" ? "Informações" : "Information"}
                  </button>
                  <button onClick={() => setActiveTab("stats")}>
                    {language === "pt-BR" ? "Estatísticas" : "Stats"}
                  </button>
                  <button onClick={() => setActiveTab("evolution")}>
                    {language === "pt-BR" ? "Evolução" : "Evolution"}
                  </button>
                </div>

                {activeTab === "info" && (
                  <div className="tab-content">
                    <img
                      className="pokemon-detail-image"
                      src={getPokemonImage(selectedPokemon)}
                      alt={selectedPokemon.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/placeholder.png";
                      }}
                    />

                    <h3>{language === "pt-BR" ? "Tipo" : "Type"}</h3>
                    <div className="types">
                      {selectedPokemon.types.map((type) => (
                        <span key={type.type.name} className="type-badge">
                          {type.type.name}
                        </span>
                      ))}
                    </div>

                    <h3>{language === "pt-BR" ? "Vantagens" : "Strengths"}</h3>
                    <div className="effectiveness">
                      {getTypeEffectiveness(selectedPokemon.types).strongAgainst.map((type, index) => (
                        <span key={`${type}-${index}`} className="type-badge">
                          {type}
                        </span>
                      ))}
                    </div>

                    <h3>{language === "pt-BR" ? "Fraquezas" : "Weaknesses"}</h3>
                    <div className="effectiveness">
                      {getTypeEffectiveness(selectedPokemon.types).weakAgainst.map((type, index) => (
                        <span key={`${type}-${index}`} className="type-badge">
                          {type}
                        </span>
                      ))}
                    </div>

                    <h3>{language === "pt-BR" ? "Detalhes" : "Details"}</h3>
                    <p>
                      {language === "pt-BR" ? "Altura" : "Height"}: {(selectedPokemon.height / 10).toFixed(1)} m
                    </p>
                    <p>
                      {language === "pt-BR" ? "Peso" : "Weight"}: {(selectedPokemon.weight / 10).toFixed(1)} kg
                    </p>
                  </div>
                )}

                {activeTab === "stats" && (
                  <div className="tab-content">
                    {selectedPokemon.stats.map((stat) => (
                      <div key={stat.stat.name} className="stat-row">
                        <span>{getStatName(stat.stat.name)}</span>
                        <span>{stat.base_stat}</span>
                      </div>
                    ))}
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
                                    <span>{step.requirement || "?"}</span>
                                  )}
                                  <span className="arrow">→</span>
                                </div>
                              )}

                              <button type="button" onClick={() => handlePokemonSelect(pokemon)}>
                                #{pokemon.id.toString().padStart(3, "0")} {pokemon.name}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="loading">
                        {language === "pt-BR" ? "Carregando evolução..." : "Loading evolution..."}
                      </div>
                    )}
                  </div>
                )}

                <div className="navigation-buttons">
                  <button onClick={() => handlePokemonNavigation("prev")}>
                    {language === "pt-BR" ? "Anterior" : "Previous"}
                  </button>
                  <button onClick={() => handlePokemonNavigation("next")}>
                    {language === "pt-BR" ? "Próximo" : "Next"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
