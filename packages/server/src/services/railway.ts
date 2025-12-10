/**
 * Railway API client for managing custom domains
 * 
 * Railway uses a GraphQL API: https://docs.railway.app/reference/public-api
 */

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

interface RailwayConfig {
  apiToken: string;
  serviceId: string;
  environmentId: string;
}

interface CustomDomainResult {
  success: boolean;
  domain?: string;
  error?: string;
  status?: 'pending' | 'active' | 'error';
}

interface DomainStatus {
  domain: string;
  status: 'pending' | 'active' | 'error';
  dnsRecords?: {
    type: string;
    name: string;
    value: string;
  }[];
}

/**
 * Get Railway configuration from environment
 * Railway automatically provides RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID
 * You only need to set RAILWAY_TOKEN (project token from Project Settings → Tokens)
 */
function getConfig(): RailwayConfig {
  const apiToken = process.env.RAILWAY_TOKEN;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;

  if (!apiToken || !serviceId || !environmentId) {
    throw new Error('Missing Railway configuration. Set RAILWAY_TOKEN from Project Settings → Tokens');
  }

  return { apiToken, serviceId, environmentId };
}

/**
 * Execute a GraphQL query against Railway API
 */
async function railwayQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const config = getConfig();
  
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json() as { data?: T; errors?: Array<{ message: string; extensions?: unknown }> };
  
  if (!response.ok) {
    console.error('Railway API error response:', JSON.stringify(result, null, 2));
    const errorMessage = result.errors?.[0]?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Railway API error: ${errorMessage}`);
  }
  
  if (result.errors) {
    throw new Error(`Railway GraphQL error: ${result.errors[0]?.message || 'Unknown error'}`);
  }

  return result.data as T;
}

/**
 * Add a custom domain to the Railway service
 */
export async function addCustomDomain(domain: string): Promise<CustomDomainResult> {
  try {
    const config = getConfig();
    
    const mutation = `
      mutation customDomainCreate($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          status {
            dnsRecords {
              requiredValue
              currentValue
              status
              hostlabel
              zone
              recordType
            }
          }
        }
      }
    `;

    const result = await railwayQuery<{
      customDomainCreate: {
        id: string;
        domain: string;
        status: {
          dnsRecords: Array<{
            requiredValue: string;
            currentValue: string;
            status: string;
            hostlabel: string;
            zone: string;
            recordType: string;
          }>;
        };
      };
    }>(mutation, {
      input: {
        domain,
        environmentId: config.environmentId,
        serviceId: config.serviceId,
      },
    });

    return {
      success: true,
      domain: result.customDomainCreate.domain,
      status: 'pending',
    };
  } catch (error) {
    console.error('Failed to add custom domain:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove a custom domain from the Railway service
 */
export async function removeCustomDomain(domain: string): Promise<CustomDomainResult> {
  try {
    const config = getConfig();
    
    // First, get the domain ID
    const domainsQuery = `
      query service($id: String!) {
        service(id: $id) {
          customDomains {
            id
            domain
          }
        }
      }
    `;

    const domainsResult = await railwayQuery<{
      service: {
        customDomains: Array<{ id: string; domain: string }>;
      };
    }>(domainsQuery, { id: config.serviceId });

    const domainEntry = domainsResult.service.customDomains.find(
      (d) => d.domain === domain
    );

    if (!domainEntry) {
      return {
        success: false,
        error: 'Domain not found',
      };
    }

    // Delete the domain
    const deleteMutation = `
      mutation customDomainDelete($id: String!) {
        customDomainDelete(id: $id)
      }
    `;

    await railwayQuery(deleteMutation, { id: domainEntry.id });

    return {
      success: true,
      domain,
    };
  } catch (error) {
    console.error('Failed to remove custom domain:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the status of a custom domain
 */
export async function getDomainStatus(domain: string): Promise<DomainStatus | null> {
  try {
    const config = getConfig();
    
    const query = `
      query service($id: String!) {
        service(id: $id) {
          customDomains {
            id
            domain
            status {
              dnsRecords {
                requiredValue
                currentValue
                status
                hostlabel
                zone
                recordType
              }
            }
          }
        }
      }
    `;

    const result = await railwayQuery<{
      service: {
        customDomains: Array<{
          id: string;
          domain: string;
          status: {
            dnsRecords: Array<{
              requiredValue: string;
              currentValue: string;
              status: string;
              hostlabel: string;
              zone: string;
              recordType: string;
            }>;
          };
        }>;
      };
    }>(query, { id: config.serviceId });

    const domainEntry = result.service.customDomains.find(
      (d) => d.domain === domain
    );

    if (!domainEntry) {
      return null;
    }

    // Determine overall status based on DNS records
    const allValid = domainEntry.status.dnsRecords.every(
      (r) => r.status === 'VALID' || r.status === 'valid'
    );

    return {
      domain: domainEntry.domain,
      status: allValid ? 'active' : 'pending',
      dnsRecords: domainEntry.status.dnsRecords.map((r) => ({
        type: r.recordType,
        name: r.hostlabel ? `${r.hostlabel}.${r.zone}` : r.zone,
        value: r.requiredValue,
      })),
    };
  } catch (error) {
    console.error('Failed to get domain status:', error);
    return null;
  }
}

/**
 * Check if Railway integration is configured
 */
export function isRailwayConfigured(): boolean {
  return !!(
    process.env.RAILWAY_TOKEN &&
    process.env.RAILWAY_SERVICE_ID &&
    process.env.RAILWAY_ENVIRONMENT_ID
  );
}

