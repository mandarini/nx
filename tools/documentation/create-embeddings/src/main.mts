// based on:
// https://github.com/supabase-community/nextjs-openai-doc-search/blob/main/lib/generate-embeddings.ts

import { createClient } from '@supabase/supabase-js';
import { config as loadDotEnvFile } from 'dotenv';
import { expand } from 'dotenv-expand';
import { readFile } from 'fs/promises';
import 'openai';
import OpenAI from 'openai';
import yargs from 'yargs';
import { createHash } from 'crypto';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { toString } from 'mdast-util-to-string';
import { u } from 'unist-builder';
import mapJson from '../../../../docs/map.json' assert { type: 'json' };
import manifestsCI from '../../../../docs/generated/manifests/ci.json' assert { type: 'json' };
import manifestsExtending from '../../../../docs/generated/manifests/extending-nx.json' assert { type: 'json' };
import manifestsNx from '../../../../docs/generated/manifests/nx.json' assert { type: 'json' };
import manifestsPackages from '../../../../docs/generated/manifests/nx-api.json' assert { type: 'json' };
import manifestsTags from '../../../../docs/generated/manifests/tags.json' assert { type: 'json' };
import communityPlugins from '../../../../community/approved-plugins.json' assert { type: 'json' };

let identityMap = {};

const myEnv = loadDotEnvFile();
expand(myEnv);

type ProcessedMdx = {
  checksum: string;
  sections: Section[];
};

type Section = {
  content: string;
  heading?: string;
  slug?: string;
};

/**
 * Splits a `mdast` tree into multiple trees based on
 * a predicate function. Will include the splitting node
 * at the beginning of each tree.
 *
 * Useful to split a markdown file into smaller sections.
 */
export function splitTreeBy(tree: any, predicate: (node: any) => boolean) {
  return tree.children.reduce((trees: any, node: any) => {
    const [lastTree] = trees.slice(-1);

    if (!lastTree || predicate(node)) {
      const tree = u('root', [node]);
      return trees.concat(tree);
    }

    lastTree.children.push(node);
    return trees;
  }, []);
}

/**
 * Processes MD content for search indexing.
 * It extracts metadata and splits it into sub-sections based on criteria.
 */
export function processMdxForSearch(content: string): ProcessedMdx {
  const checksum = createHash('sha256').update(content).digest('base64');

  const mdTree = fromMarkdown(content, {});

  if (!mdTree) {
    return {
      checksum,
      sections: [],
    };
  }

  const sectionTrees = splitTreeBy(mdTree, (node) => node.type === 'heading');

  const slugger = new GithubSlugger();

  const sections = sectionTrees.map((tree: any) => {
    const [firstNode] = tree.children;

    const heading =
      firstNode.type === 'heading' ? toString(firstNode) : undefined;
    const slug = heading ? slugger.slug(heading) : undefined;

    return {
      content: toMarkdown(tree),
      heading,
      slug,
    };
  });

  return {
    checksum,
    sections,
  };
}

type WalkEntry = {
  path: string;
  url_partial: string;
};

abstract class BaseEmbeddingSource {
  checksum?: string;
  sections?: Section[];

  constructor(
    public source: string,
    public path: string,
    public url_partial: string
  ) {}

  abstract load(): Promise<{
    checksum: string;
    sections: Section[];
  }>;
}

class MarkdownEmbeddingSource extends BaseEmbeddingSource {
  type: 'markdown' = 'markdown';

  constructor(
    source: string,
    public filePath: string,
    public url_partial: string,
    public fileContent?: string
  ) {
    const path = filePath.replace(/^docs/, '').replace(/\.md?$/, '');
    super(source, path, url_partial);
  }

  async load() {
    const contents =
      this.fileContent ?? (await readFile(this.filePath, 'utf8'));

    const { checksum, sections } = processMdxForSearch(contents);

    this.checksum = checksum;
    this.sections = sections;

    return {
      checksum,
      sections,
    };
  }
}

type EmbeddingSource = MarkdownEmbeddingSource;

if (!process.env.NX_NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error(
    'Environment variable NX_NEXT_PUBLIC_SUPABASE_URL is required: skipping embeddings generation'
  );
}

if (!process.env.NX_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Environment variable NX_SUPABASE_SERVICE_ROLE_KEY is required: skipping embeddings generation'
  );
}

if (!process.env.NX_OPENAI_KEY) {
  throw new Error(
    'Environment variable NX_OPENAI_KEY is required: skipping embeddings generation'
  );
}

const supabaseClient = createClient(
  process.env.NX_NEXT_PUBLIC_SUPABASE_URL,
  process.env.NX_SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

async function generateEmbeddings() {
  const argv = await yargs().option('refresh', {
    alias: 'r',
    description: 'Refresh data',
    type: 'boolean',
  }).argv;

  const shouldRefresh = argv.refresh;

  // Ensures that indentityMap gets populated first
  let allFilesPaths = [...getAllFilesWithItemList(manifestsNx)];

  allFilesPaths = [
    ...allFilesPaths,
    ...getAllFilesFromMapJson(mapJson),
    ...getAllFilesWithItemList(manifestsCI),
    ...getAllFilesWithItemList(manifestsExtending),
    ...getAllFilesWithItemList(manifestsPackages),
    ...getAllFilesWithItemList(manifestsTags),
  ].filter(
    (entry) =>
      !entry.path.includes('sitemap') && !entry.path.includes('deprecated')
  );

  const embeddingSources: EmbeddingSource[] = [
    ...allFilesPaths.map((entry) => {
      return new MarkdownEmbeddingSource(
        'guide',
        entry.path,
        entry.url_partial
      );
    }),
    ...createMarkdownForCommunityPlugins().map((content, index) => {
      return new MarkdownEmbeddingSource(
        'community-plugins',
        '/community/approved-plugins.json#' + index,
        content.url,
        content.text
      );
    }),
  ];

  console.log(`Discovered ${embeddingSources.length} pages`);

  if (!shouldRefresh) {
    console.log('Checking which pages are new or have changed');
  } else {
    console.log('Refresh flag set, re-generating all pages');
  }

  for (const [index, embeddingSource] of embeddingSources.entries()) {
    const { type, source, path, url_partial } = embeddingSource;

    try {
      const { checksum, sections } = await embeddingSource.load();

      // Check for existing page in DB and compare checksums
      const { error: fetchPageError, data: existingPage } = await supabaseClient
        .from('nods_page')
        .select('id, path, checksum')
        .filter('path', 'eq', path)
        .limit(1)
        .maybeSingle();

      if (fetchPageError) {
        throw fetchPageError;
      }

      // We use checksum to determine if this page & its sections need to be regenerated
      if (!shouldRefresh && existingPage?.checksum === checksum) {
        continue;
      }

      if (existingPage) {
        if (!shouldRefresh) {
          console.log(
            `#${index}: [${path}] Docs have changed, removing old page sections and their embeddings`
          );
        } else {
          console.log(
            `#${index}: [${path}] Refresh flag set, removing old page sections and their embeddings`
          );
        }

        const { error: deletePageSectionError } = await supabaseClient
          .from('nods_page_section')
          .delete()
          .filter('page_id', 'eq', existingPage.id);

        if (deletePageSectionError) {
          throw deletePageSectionError;
        }
      }

      // Create/update page record. Intentionally clear checksum until we
      // have successfully generated all page sections.
      const { error: upsertPageError, data: page } = await supabaseClient
        .from('nods_page')
        .upsert(
          {
            checksum: null,
            path,
            url_partial,
            type,
            source,
          },
          { onConflict: 'path' }
        )
        .select()
        .limit(1)
        .single();

      if (upsertPageError) {
        throw upsertPageError;
      }

      console.log(
        `#${index}: [${path}] Adding ${sections.length} page sections (with embeddings)`
      );
      console.log(
        `${embeddingSources.length - index - 1} pages remaining to process.`
      );

      for (const { slug, heading, content } of sections) {
        // OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
        const input = content.replace(/\n/g, ' ');

        try {
          const openai = new OpenAI({
            apiKey: process.env.NX_OPENAI_KEY,
          });
          const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input,
          });

          const [responseData] = embeddingResponse.data;

          const longer_heading =
            source !== 'community-plugins'
              ? createLongerHeading(heading, url_partial)
              : heading;

          const { error: insertPageSectionError, data: pageSection } =
            await supabaseClient
              .from('nods_page_section')
              .insert({
                page_id: page.id,
                slug,
                heading:
                  heading?.length && heading !== null && heading !== 'null'
                    ? heading
                    : longer_heading,
                longer_heading,
                content,
                url_partial,
                token_count: embeddingResponse.usage.total_tokens,
                embedding: responseData.embedding,
              })
              .select()
              .limit(1)
              .single();

          if (insertPageSectionError) {
            throw insertPageSectionError;
          }

          // Add delay after each request
          await delay(500); // delay of 0.5 second
        } catch (err) {
          // TODO: decide how to better handle failed embeddings
          console.error(
            `Failed to generate embeddings for '${path}' page section starting with '${input.slice(
              0,
              40
            )}...'`
          );

          throw err;
        }
      }

      // Set page checksum so that we know this page was stored successfully
      const { error: updatePageError } = await supabaseClient
        .from('nods_page')
        .update({ checksum })
        .filter('id', 'eq', page.id);

      if (updatePageError) {
        throw updatePageError;
      }
    } catch (err) {
      console.error(
        `Page '${path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`
      );
      console.error(err);
    }
  }

  console.log('Embedding generation complete');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAllFilesFromMapJson(doc): WalkEntry[] {
  const files: WalkEntry[] = [];
  function traverse(itemList) {
    for (const item of itemList) {
      if (item.file && item.file.length > 0) {
        // we can exclude some docs here, eg. the deprecated ones
        // the path is the relative path to the file within the nx repo
        // the url_partial is the relative path to the file within the docs site - under nx.dev
        files.push({
          path: `docs/${item.file}.md`,
          url_partial: identityMap[item.id]?.path || '',
        });
      }

      if (item.itemList) {
        traverse(item.itemList);
      }
    }
  }

  for (const item of doc.content) {
    traverse([item]);
  }
  return files;
}

function getAllFilesWithItemList(data: any, noDocs?: boolean): WalkEntry[] {
  let files: WalkEntry[] = [];

  function traverse(itemList: any[]) {
    for (const item of itemList) {
      if (item.file && item.file.length > 0) {
        const filePath = item.file.endsWith('.json')
          ? item.file
          : `${item.file}.md`;
        files.push({ path: `docs/${filePath}`, url_partial: item.path });
        if (!identityMap[item.id]) {
          identityMap = { ...identityMap, [item.id]: item };
        }
      }

      if (item.itemList) {
        traverse(item.itemList);
      }
    }
  }

  for (const key in data) {
    const entry = data[key];

    // Process top-level items
    if (entry.file && entry.file.length > 0) {
      const filePath = entry.file.endsWith('.json')
        ? entry.file
        : `${entry.file}.md`;
      files.push({ path: `docs/${filePath}`, url_partial: entry.path });
      if (!identityMap[entry.id]) {
        identityMap = { ...identityMap, [entry.id]: entry };
      }
    }

    // Process items with itemList
    if (entry.itemList) {
      traverse(entry.itemList);
    }

    // Recursively process documents, generators, executors
    if (entry.documents && !noDocs) {
      files = files.concat(getAllFilesWithItemList(entry.documents));
    }
    if (entry.generators) {
      files = files.concat(getAllFilesWithItemList(entry.generators));
    }
    if (entry.executors) {
      files = files.concat(getAllFilesWithItemList(entry.executors));
    }

    // Process arrays directly
    if (Array.isArray(entry) && entry.length > 0) {
      traverse(entry);
    }
  }

  return files;
}

function createLongerHeading(
  heading?: string | null,
  url_partial?: string
): string | undefined {
  if (url_partial?.length) {
    if (heading?.length && heading !== null && heading !== 'null') {
      return `${heading}${` - ${
        url_partial.split('/')?.[1]?.[0]?.toUpperCase() +
        url_partial.split('/')?.[1]?.slice(1)
      }`}`;
    } else {
      return url_partial
        .split('#')[0]
        .split('/')
        .map((part) =>
          part?.length ? part[0]?.toUpperCase() + part.slice(1) + ' - ' : ''
        )
        .join('')
        .slice(0, -3);
    }
  }
}

function createMarkdownForCommunityPlugins(): {
  text: string;
  url: string;
}[] {
  return communityPlugins.map((plugin) => {
    return {
      text: `## ${plugin.name} plugin\n\nThere is a ${plugin.name} community plugin.\n\nHere is the description for it: ${plugin.description}\n\nHere is the link to it: [${plugin.url}](${plugin.url})\n\nHere is the list of all the plugins that exist for Nx: https://nx.dev/plugin-registry`,
      url: plugin.url,
    };
  });
}

type Page = {
  checksum: string;
  contents: string;
};

export function createChecksum(contents: string): Page {
  const checksum = createHash('sha256').update(contents).digest('base64');

  return {
    checksum,
    contents,
  };
}

abstract class BaseEmbeddingSourceForNxAPI {
  checksum?: string;
  contents: string;

  constructor(
    public source: string,
    public path: string,
    public url_partial: string
  ) {}

  abstract load(): Promise<{
    checksum: string;
    contents: string;
  }>;
}

class MarkdownEmbeddingSourceForNxApi extends BaseEmbeddingSourceForNxAPI {
  type: 'markdown' = 'markdown';

  constructor(
    source: string,
    public filePath: string,
    public url_partial: string,
    public fileContent?: string
  ) {
    const path = filePath.replace(/^docs/, '').replace(/\.md?$/, '');
    super(source, path, url_partial);
  }

  async load() {
    const contentsOfFile =
      this.fileContent ?? (await readFile(this.filePath, 'utf8'));

    const { checksum, contents } = createChecksum(contentsOfFile);

    this.checksum = checksum;
    this.contents = contents;

    return {
      checksum,
      contents,
    };
  }
}

type EmbeddingSourceForNxApi = MarkdownEmbeddingSourceForNxApi;

export async function generateEmbeddingsForNxAPI(supabaseClient) {
  const argv = await yargs().option('refresh', {
    alias: 'r',
    description: 'Refresh data',
    type: 'boolean',
  }).argv;

  const shouldRefresh = argv.refresh;

  let allFilesPaths = [...getAllFilesWithItemList(manifestsPackages, true)];
  console.log(allFilesPaths);
  allFilesPaths = allFilesPaths.filter(
    (entry) =>
      !entry.path.includes('sitemap') && !entry.path.includes('deprecated')
  );

  const embeddingSources: EmbeddingSourceForNxApi[] = [
    ...allFilesPaths.map((entry) => {
      return new MarkdownEmbeddingSourceForNxApi(
        'nx-api',
        entry.path,
        entry.url_partial
      );
    }),
  ];

  console.log(`Discovered ${embeddingSources.length} pages`);

  if (!shouldRefresh) {
    console.log('Checking which pages are new or have changed');
  } else {
    console.log('Refresh flag set, re-generating all pages');
  }

  for (const [index, embeddingSource] of embeddingSources.entries()) {
    const { type, source, path, url_partial } = embeddingSource;

    try {
      const { checksum, contents } = await embeddingSource.load();

      // OpenAI processing for embeddings
      const input = contents.replace(/\n/g, ' ');
      const openai = new OpenAI({ apiKey: process.env.NX_OPENAI_KEY });
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input,
      });

      const [responseData] = embeddingResponse.data;

      // Upsert page record with all data including checksum and embedding
      const { error: upsertPageError } = await supabaseClient
        .from('nx_api_docs')
        .upsert({
          checksum: checksum,
          path: path,
          url_partial: url_partial,
          type: type,
          source: source,
          content: contents,
          token_count: embeddingResponse.usage.total_tokens,
          embedding: responseData.embedding,
        })
        .select()
        .limit(1)
        .single();

      if (upsertPageError) {
        throw upsertPageError;
      }

      console.log(
        `${embeddingSources.length - index - 1} pages remaining to process.`
      );

      // Add delay after each request
      await delay(500); // delay of 0.5 second
    } catch (err) {
      console.error(`Failed to process '${path}': ${err}`);
    }
  }
  console.log('Embedding for Nx API generation complete');
}

async function main() {
  await generateEmbeddings();
  await generateEmbeddingsForNxAPI(supabaseClient);
}

main().catch((err) => console.error(err));
