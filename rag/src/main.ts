import { createChromaClient } from "./db/chroma";

async function main() {
  const client = createChromaClient();
  const collection = await client.getOrCreateCollection({ name: "planets" });

  const ids = ["mercury", "venus", "earth", "mars", "jupiter", "saturn"];
  const documents = [
    "Mercury is the smallest planet and closest to the Sun with extreme temperature swings.",
    "Venus has a thick toxic atmosphere and is the hottest planet in the solar system.",
    "Earth is the only known planet to support life, with liquid water on its surface.",
    "Mars is the red planet with the largest volcano and canyon in the solar system.",
    "Jupiter is a massive gas giant with a Great Red Spot storm lasting hundreds of years.",
    "Saturn is famous for its spectacular ring system made of ice and rock particles.",
  ];
  const metadatas = [
    { type: "rocky", order: 1 },
    { type: "rocky", order: 2 },
    { type: "rocky", order: 3 },
    { type: "rocky", order: 4 },
    { type: "gas_giant", order: 5 },
    { type: "gas_giant", order: 6 },
  ];

  await collection.add({ ids, documents, metadatas });

  console.log("=== Ingested Data ===");
  for (let i = 0; i < ids.length; i++) {
    console.log(`  [${ids[i]}] ${documents[i]}`);
  }

  const queries = [
    "Which planet has liquid water?",
    "Tell me about gas giants with rings",
  ];

  for (const query of queries) {
    console.log(`\n=== Query: "${query}" ===`);
    const results = await collection.query({ queryTexts: [query], nResults: 2 });

    for (let i = 0; i < results.ids[0].length; i++) {
      const id = results.ids[0][i];
      const doc = results.documents[0][i];
      const dist = results.distances![0][i];
      console.log(`  ${i + 1}. [${id}] (distance=${dist?.toFixed(4)}) ${doc}`);
    }
  }
}

main().catch(console.error);
