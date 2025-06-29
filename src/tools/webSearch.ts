import { z } from "zod";
import axios from "axios";
import { toolRegistry, API_CONFIG } from "./config.js";
import { ExaSearchRequest, ExaSearchResponse } from "../types.js";
import { createRequestLogger } from "../utils/logger.js";

// Register the web search tool
toolRegistry["exa_search"] = {
  name: "exa_search",
  description: "Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs. Supports configurable result counts and returns the content from the most relevant websites.",
  schema: {
    query: z.string().describe("Query string for the search.\nIMPORTANT: When using neural search (type=neural) you MUST frame queries as if you’re sharing a link to someone. (1. Phrase as Statements: \"Here’s a great article about X:\" works better than \"What is X?\" 2. Add Context: Include modifiers like \"funny\", \"academic\", or specific websites to narrow results. 3. End with a Colon: Many effective prompts end with \":\", mimicking natural link sharing.)"),
    type: z.enum(["auto","keyword","neural"]).optional().describe(`Type of search.\n1. \"neural\" uses an embeddings-based model. \n2. \"keyword\" keyword search.\n3. \"auto\" automatically decides between keyword and neural.\n(default: ${API_CONFIG.DEFAULT_TYPE})`),
    category: z.enum(["company","research paper","news","pdf","github","tweet","personal site","linkedin profile","financial report"]).optional().describe("Data category to focus on. Available options: company, research paper, news, pdf, github, tweet, personal site, linkedin profile, financial report"),
    numResults: z.number().max(100).optional().describe(`Number of search results to return (default: ${API_CONFIG.DEFAULT_NUM_RESULTS})`),
    includeDomains: z.string().array().optional().describe("List of domains to include in the search. If specified, results will come *ONLY* from these domains. Example: [\"arxiv.org\", \"paperswithcode.com\"]"),
    excludeDomains: z.string().array().optional().describe("List of domains to exclude from search results. If specified, no results will be returned from these domains.")
  },
  handler: async ({ query, type, category, numResults, includeDomains, excludeDomains }, extra) => {
    const requestId = `exa_search-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const logger = createRequestLogger(requestId, 'exa_search');
    
    logger.start(query);
    
    try {
      // Create a fresh axios instance for each request
      const axiosInstance = axios.create({
        baseURL: API_CONFIG.BASE_URL,
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-api-key': process.env.EXA_API_KEY || ''
        },
        timeout: 25000
      });

      const searchRequest: ExaSearchRequest = {
        query,
        type: type || API_CONFIG.DEFAULT_TYPE,
        ...(category ? { category } : {}),
        numResults: numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
        ...(includeDomains ? { includeDomains } : {}),
        ...(excludeDomains ? { excludeDomains } : {}),
        contents: {
          text: {
            maxCharacters: API_CONFIG.DEFAULT_MAX_CHARACTERS
          },
          livecrawl: 'always'
        }
      };
      
      logger.log(`searchRequest: ${JSON.stringify(searchRequest, null, 2)}`); // jb
      logger.log("Sending request to Exa API"); 
      
      const response = await axiosInstance.post<ExaSearchResponse>(
        API_CONFIG.ENDPOINTS.SEARCH,
        searchRequest,
        { timeout: 25000 }
      );
      
      logger.log("Received response from Exa API");

      if (!response.data || !response.data.results) {
        logger.log("Warning: Empty or invalid response from Exa API");
        return {
          content: [{
            type: "text" as const,
            text: "No search results found. Please try a different query."
          }]
        };
      }

      logger.log(`Found ${response.data.results.length} results`);
      
      const result = {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response.data, null, 2)
        }]
      };
      
      logger.complete();
      return result;
    } catch (error) {
      logger.error(error);
      
      if (axios.isAxiosError(error)) {
        // Handle Axios errors specifically
        const statusCode = error.response?.status || 'unknown';
        const errorMessage = error.response?.data?.message || error.message;
        
        logger.log(`Axios error (${statusCode}): ${errorMessage}`);
        return {
          content: [{
            type: "text" as const,
            text: `Search error (${statusCode}): ${errorMessage}`
          }],
          isError: true,
        };
      }
      
      // Handle generic errors
      return {
        content: [{
          type: "text" as const,
          text: `Search error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true,
      };
    }
  },
  enabled: true  // Enabled by default
}; 