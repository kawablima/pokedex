import React, { useEffect, useState, useCallback, useMemo } from "react";
import "./PokeDex.css";

// Interfaces
interface Pokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  sprites: {
    front_default: string;
    other?: {
      "official-artwork"?: {
        front_default?: string;
      };
    };
  };
  types: Array<{
    type: {
      name: string;
    };
  }>;
  abilities: Array<{
    ability: {
      name: string;
    };
  }>;
  stats: Array<{
    base_stat: number;
    stat: {
      name: string;
    };
  }>;
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
  stoneImage?: string; // Adicionado para armazenar a URL da imagem da pedra
}

// Constantes
const POKEMON_LIMIT = 1025; // Carregando todos os 1025 Pokémon
const BATCH_SIZE = 20; // Tamanho do lote para requisições
const RETRY_ATTEMPTS = 3; // Número de tentativas para cada requisição
const RETRY_DELAY_MS = 3000; // Delay entre tentativas (1 segundo)
const BATCH_DELAY_MS = 500; // Delay entre lotes
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
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPokemon, setSelectedPokemon] = useState<Pokemon | null>(null);
  const [filterGeneration, setFilterGeneration] = useState("all");
  const [activeTab, setActiveTab] = useState("info");
  const [currentPokemonIndex, setCurrentPokemonIndex] = useState<number | null>(
    null
  );
  const [language, setLanguage] = useState<"pt-BR" | "en">("pt-BR");
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [evolutionChains, setEvolutionChains] = useState<
    Record<number, EvolutionStep[]>
  >({});

  // Função para buscar dados com retry
  const fetchWithRetry = useCallback(async (url: string, retries = RETRY_ATTEMPTS): Promise<any> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
      } catch (err) {
        if (attempt === retries) {
          throw err; // Após o último retry, lançar o erro
        }
        console.warn(`Attempt ${attempt} failed for ${url}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS)); // Delay antes de tentar novamente
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
  }, []);

  // Mapeia itens para nomes legíveis
  const mapItemToName = useCallback(
    (itemName: string, lang: "pt-BR" | "en") => {
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
    },
    []
  );

  // Extrai passos da cadeia evolutiva
  const extractEvolutionChainSteps = useCallback(
    (
      evolutionChain: EvolutionChain,
      pokemonList: Pokemon[]
    ): EvolutionStep[] => {
      const steps: EvolutionStep[] = [];

      const traverseChain = (
        chain: EvolutionChain["chain"],
        parentId?: number
      ) => {
        const speciesUrl = chain.species.url;
        const id = parseInt(speciesUrl.split("/").slice(-2, -1)[0], 10);
        const pokemon = pokemonList.find((p) => p.id === id);
        const name = pokemon?.name || chain.species.name;

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
            requirement = mapItemToName(itemName, language); // Usado apenas para o tooltip
          } else if (details.trigger.name === "trade") {
            requirement = language === "pt-BR" ? "Trocar" : "Trade";
          }
        }

        steps.push({ id, name, requirement, stoneImage });

        chain.evolves_to.forEach((next) => traverseChain(next, id));
      };

      traverseChain(evolutionChain.chain);
      return steps;
    },
    [language, mapItemToName]
  );

  // Processa cadeias evolutivas
  const processEvolutionChains = useCallback(
    async (pokemonList: Pokemon[]) => {
      const chains: Record<number, EvolutionStep[]> = {};
      const processedChains = new Set<number>();

      for (const pokemon of pokemonList) {
        try {
          const speciesData = await fetchWithRetry(
            `https://pokeapi.co/api/v2/pokemon-species/${pokemon.id}`
          );
          const chainId = parseInt(
            speciesData.evolution_chain.url.split("/").slice(-2, -1)[0],
            10
          );

          if (!processedChains.has(chainId)) {
            const evolutionData = await fetchWithRetry(
              speciesData.evolution_chain.url
            );
            const chainSteps = extractEvolutionChainSteps(
              evolutionData,
              pokemonList
            );

            chainSteps.forEach((step) => {
              chains[step.id] = chainSteps;
            });

            processedChains.add(chainId);
          }
        } catch (err) {
          console.warn(
            `Failed to process evolution for Pokémon ${pokemon.id}:`,
            err
          );
        }
      }

      setEvolutionChains(chains);
    },
    [fetchWithRetry, extractEvolutionChainSteps]
  );

  // Função para calcular vantagens e desvantagens com base nos tipos
  const getTypeEffectiveness = (types: Pokemon["types"]) => {
    const typeEffectiveness: {
      [key: string]: { strongAgainst: string[]; weakAgainst: string[] };
    } = {
      normal: { strongAgainst: [], weakAgainst: ["rock", "steel"] },
      fire: {
        strongAgainst: ["grass", "ice", "bug", "steel"],
        weakAgainst: ["water", "rock", "fire"],
      },
      water: {
        strongAgainst: ["fire", "ground", "rock"],
        weakAgainst: ["grass", "electric"],
      },
      grass: {
        strongAgainst: ["water", "ground", "rock"],
        weakAgainst: ["fire", "flying", "poison", "bug"],
      },
      electric: {
        strongAgainst: ["water", "flying"],
        weakAgainst: ["grass", "electric", "dragon"],
      },
      ice: {
        strongAgainst: ["grass", "ground", "flying", "dragon"],
        weakAgainst: ["fire", "water", "ice", "steel"],
      },
      fighting: {
        strongAgainst: ["normal", "rock", "steel", "ice", "dark"],
        weakAgainst: ["flying", "psychic", "fairy"],
      },
      poison: {
        strongAgainst: ["grass", "fairy"],
        weakAgainst: ["ground", "psychic"],
      },
      ground: {
        strongAgainst: ["fire", "electric", "rock", "steel"],
        weakAgainst: ["grass", "water"],
      },
      flying: {
        strongAgainst: ["grass", "fighting", "bug"],
        weakAgainst: ["rock", "electric", "ice"],
      },
      psychic: {
        strongAgainst: ["fighting", "poison"],
        weakAgainst: ["bug", "ghost", "dark"],
      },
      bug: {
        strongAgainst: ["grass", "psychic", "dark"],
        weakAgainst: ["fire", "flying", "rock"],
      },
      rock: {
        strongAgainst: ["fire", "ice", "flying", "bug"],
        weakAgainst: ["water", "grass"],
      },
      ghost: { strongAgainst: ["psychic", "ghost"], weakAgainst: ["dark"] },
      dragon: { strongAgainst: ["dragon"], weakAgainst: ["ice", "fairy"] },
      dark: {
        strongAgainst: ["psychic", "ghost"],
        weakAgainst: ["fighting", "fairy"],
      },
      steel: {
        strongAgainst: ["ice", "rock", "fairy"],
        weakAgainst: ["fire", "water", "electric"],
      },
      fairy: {
        strongAgainst: ["fighting", "dragon", "dark"],
        weakAgainst: ["steel", "poison"],
      },
    };

    let strongAgainst: string[] = [];
    let weakAgainst: string[] = [];

    types.forEach((type) => {
      const typeName = type.type.name.toLowerCase();
      if (typeEffectiveness[typeName]) {
        const combinedStrong = [
          ...strongAgainst,
          ...typeEffectiveness[typeName].strongAgainst,
        ];
        strongAgainst = Array.from(new Set(combinedStrong));

        const combinedWeak = [
          ...weakAgainst,
          ...typeEffectiveness[typeName].weakAgainst,
        ];
        weakAgainst = Array.from(new Set(combinedWeak));
      }
    });

    return { strongAgainst, weakAgainst };
  };

  // Função para aguardar um delay
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Carrega dados dos Pokémon
  const fetchPokemonData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(0);
  
    try {
      const listUrl = `https://pokeapi.co/api/v2/pokemon?limit=${POKEMON_LIMIT}`;
      const listData = await fetchWithRetry(listUrl);
      const pokemonUrls = listData.results.map((result: { url: string }) => result.url);
  
      const pokemonArray: Pokemon[] = [];
      const errors: string[] = [];
      let fetchedCount = 0;
  
      for (let i = 0; i < pokemonUrls.length; i += BATCH_SIZE) {
        const batchUrls = pokemonUrls.slice(i, i + BATCH_SIZE);
  
        const fetchPromises = batchUrls.map(async (url: string) => {
          const data = await fetchWithRetry(url);
          return data as Pokemon;
        });
  
        const results = await Promise.allSettled(fetchPromises);
  
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            pokemonArray.push(result.value as Pokemon);
          } else {
            const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            errors.push(`Failed to fetch Pokémon at ${batchUrls[index]}: ${errorMsg}`);
          }
        });
  
        fetchedCount += batchUrls.length;
        setProgress(Math.round((fetchedCount / POKEMON_LIMIT) * 100));
  
        if (i + BATCH_SIZE < pokemonUrls.length) {
          await delay(BATCH_DELAY_MS);
        }
      }
  
      if (errors.length > 0) {
        console.warn("Some Pokémon failed to load:", errors);
      }
  
      if (pokemonArray.length === 0) {
        throw new Error("No Pokémon data retrieved.");
      }
  
      pokemonArray.sort((a, b) => a.id - b.id);
      setPokemonList(pokemonArray);
  
      await processEvolutionChains(pokemonArray);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to load Pokémon data: ${errorMessage}. Please try again later.`);
      console.error("Error loading Pokémon:", err);
    } finally {
      setLoading(false);
      setProgress(100);
    }
  }, [fetchWithRetry, processEvolutionChains]);

  // Filtra Pokémon por termo de busca e geração
  const filteredPokemon = useMemo(() => {
    return pokemonList.filter((pokemon) => {
      const matchesSearch = pokemon.name
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
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
    const groups = GENERATIONS.map((gen) => ({
      ...gen,
      pokemon: [] as Pokemon[],
    }));

    filteredPokemon.forEach((pokemon) => {
      const group = groups.find(
        (g) => pokemon.id >= g.range[0] && pokemon.id <= g.range[1]
      );
      if (group) group.pokemon.push(pokemon);
    });

    return groups.filter((group) => group.pokemon.length > 0);
  }, [filteredPokemon]);

  // Efeito para carregar dados iniciais
  useEffect(() => {
    fetchPokemonData();
  }, [fetchPokemonData]);

  // Handlers
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleGenerationFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilterGeneration(e.target.value);
  };

  const handlePokemonSelect = (pokemon: Pokemon) => {
    setSelectedPokemon(pokemon);
    setCurrentPokemonIndex(pokemonList.findIndex((p) => p.id === pokemon.id));
  };

  const handlePokemonNavigation = (direction: "prev" | "next") => {
    if (currentPokemonIndex === null) return;

    const newIndex =
      direction === "prev"
        ? currentPokemonIndex > 0
          ? currentPokemonIndex - 1
          : pokemonList.length - 1
        : currentPokemonIndex < pokemonList.length - 1
        ? currentPokemonIndex + 1
        : 0;

    setCurrentPokemonIndex(newIndex);
    setSelectedPokemon(pokemonList[newIndex]);
  };

  const closeModal = () => {
    setSelectedPokemon(null);
    setActiveTab("info");
    setCurrentPokemonIndex(null);
  };

  // Funções auxiliares para dados de Pokémon
  const getPokemonImage = (pokemon: Pokemon) => {
    return (
      pokemon.sprites.other?.["official-artwork"]?.front_default ||
      pokemon.sprites.front_default ||
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

  // Renderização
  return (
    <div className="pokedex-container">
      {/* Cabeçalho e controles */}
      <header className="pokedex-header">
        <h1>{language === "pt-BR" ? "Pokédex" : "Pokédex"}</h1>

        <div className="controls">
          <div className="language-selector">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "pt-BR" | "en")}
            >
              <option value="pt-BR">Português</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="search-filter">
            <input
              type="text"
              placeholder={
                language === "pt-BR" ? "Buscar Pokémon..." : "Search Pokémon..."
              }
              value={searchTerm}
              onChange={handleSearch}
            />

            <select value={filterGeneration} onChange={handleGenerationFilter}>
              <option value="all">
                {language === "pt-BR" ? "Todas Gerações" : "All Generations"}
              </option>
              {GENERATIONS.map((gen) => (
                <option key={gen.id} value={`gen${gen.id}`}>
                  {language === "pt-BR"
                    ? `Gen ${gen.id} (${gen.name})`
                    : `Gen ${gen.id} (${gen.name})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Conteúdo principal */}
      <main className="pokedex-main">
        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">
            {language === "pt-BR"
              ? `Carregando... ${progress}%`
              : `Loading... ${progress}%`}
          </div>
        ) : (
          <div className="pokemon-grid-container">
            {groupedPokemon.map((group) => (
              <section key={group.id} className="generation-section">
                <h2>{`${language === "pt-BR" ? "Geração" : "Generation"} ${
                  group.id
                } - ${group.name}`}</h2>
                <div className="pokemon-grid">
                  {group.pokemon.map((pokemon) => (
                    <div
                      key={pokemon.id}
                      className="pokemon-card"
                      onClick={() => handlePokemonSelect(pokemon)}
                    >
                      <img
                        src={getPokemonImage(pokemon)}
                        alt={pokemon.name}
                        className="pokemon-image"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "/placeholder.png";
                        }}
                      />
                      <div className="pokemon-info">
                        <span className="pokemon-id">
                          #{pokemon.id.toString().padStart(3, "0")}
                        </span>
                        <h3 className="pokemon-name">{pokemon.name}</h3>
                        <div className="pokemon-types">
                          {pokemon.types.map((type) => (
                            <span
                              key={type.type.name}
                              className={`type-badge type-${type.type.name}`}
                            >
                              {type.type.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Modal de detalhes */}
      {selectedPokemon && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                #{selectedPokemon.id.toString().padStart(3, "0")}{" "}
                {selectedPokemon.name}
              </h2>
              <button className="close-button" onClick={closeModal}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="pokemon-image-container">
                <img
                  src={getPokemonImage(selectedPokemon)}
                  alt={selectedPokemon.name}
                  className="main-pokemon-image"
                />
              </div>

              <div className="modal-tabs">
                <button
                  className={`tab-button ${
                    activeTab === "info" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("info")}
                >
                  {language === "pt-BR" ? "Informações" : "Information"}
                </button>
                <button
                  className={`tab-button ${
                    activeTab === "stats" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("stats")}
                >
                  {language === "pt-BR" ? "Estatísticas" : "Stats"}
                </button>
                <button
                  className={`tab-button ${
                    activeTab === "evolution" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("evolution")}
                >
                  {language === "pt-BR" ? "Evolução" : "Evolution"}
                </button>
              </div>

              <div className="tab-content">
                {activeTab === "info" && (
                  <div className="info-tab">
                    <div className="info-section">
                      <h3>{language === "pt-BR" ? "Tipo" : "Type"}</h3>
                      <div className="types-container">
                        {selectedPokemon.types.map((type) => (
                          <span
                            key={type.type.name}
                            className={`type-badge type-${type.type.name}`}
                          >
                            {type.type.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="info-section">
                      <h3>{language === "pt-BR" ? "Vantagens" : "Strengths"}</h3>
                      <div className="types-container">
                        {getTypeEffectiveness(selectedPokemon.types).strongAgainst.map((type, index) => (
                          <span
                            key={index}
                            className={`type-badge type-${type.toLowerCase()}`}
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="info-section">
                      <h3>{language === "pt-BR" ? "Fraquezas" : "Weaknesses"}</h3>
                      <div className="types-container">
                        {getTypeEffectiveness(selectedPokemon.types).weakAgainst.map((type, index) => (
                          <span
                            key={index}
                            className={`type-badge type-${type.toLowerCase()}`}
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="info-section">
                      <h3>{language === "pt-BR" ? "Detalhes" : "Details"}</h3>
                      <div className="details-grid">
                        <div>
                          <span>
                            {language === "pt-BR" ? "Altura" : "Height"}
                          </span>
                          <span>
                            {(selectedPokemon.height / 10).toFixed(1)} m
                          </span>
                        </div>
                        <div>
                          <span>
                            {language === "pt-BR" ? "Peso" : "Weight"}
                          </span>
                          <span>
                            {(selectedPokemon.weight / 10).toFixed(1)} kg
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "stats" && (
                  <div className="stats-tab">
                    <div className="stats-container">
                      {selectedPokemon.stats.map((stat) => (
                        <div key={stat.stat.name} className="stat-row">
                          <span className="stat-name">
                            {getStatName(stat.stat.name)}
                          </span>
                          <div className="stat-bar-container">
                            <div
                              className="stat-bar"
                              style={{
                                width: `${(stat.base_stat / 255) * 100}%`,
                              }}
                            ></div>
                          </div>
                          <span className="stat-value">{stat.base_stat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "evolution" && (
                  <div className="evolution-tab">
                    {evolutionChains[selectedPokemon.id] ? (
                      <div className="evolution-chain">
                        {evolutionChains[selectedPokemon.id].map(
                          (step, index) => {
                            const pokemon = pokemonList.find(
                              (p) => p.id === step.id
                            );
                            if (!pokemon) return null;

                            return (
                              <React.Fragment key={step.id}>
                                {index > 0 && (
                                  <div className="evolution-arrow">
                                    {step.stoneImage ? (
                                      <div className="stone-image-tooltip">
                                        <img
                                          src={step.stoneImage}
                                          alt={step.requirement}
                                          className="stone-image"
                                        />
                                        <span className="tooltip-text">
                                          {step.requirement}
                                        </span>
                                      </div>
                                    ) : (
                                      <span>{step.requirement || "?"}</span>
                                    )}
                                    <div className="arrow-icon">→</div>
                                  </div>
                                )}
                                <div
                                  className={`evolution-step ${
                                    pokemon.id === selectedPokemon.id
                                      ? "current"
                                      : ""
                                  }`}
                                  onClick={() => handlePokemonSelect(pokemon)}
                                >
                                  <img
                                    src={getPokemonImage(pokemon)}
                                    alt={pokemon.name}
                                  />
                                  <span>
                                    #{pokemon.id.toString().padStart(3, "0")}
                                  </span>
                                  <span>{pokemon.name}</span>
                                </div>
                              </React.Fragment>
                            );
                          }
                        )}
                      </div>
                    ) : (
                      <p>
                        {language === "pt-BR"
                          ? "Nenhuma cadeia evolutiva encontrada."
                          : "No evolution chain found."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="nav-button"
                onClick={() => handlePokemonNavigation("prev")}
              >
                {language === "pt-BR" ? "Anterior" : "Previous"}
              </button>
              <button
                className="nav-button"
                onClick={() => handlePokemonNavigation("next")}
              >
                {language === "pt-BR" ? "Próximo" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;