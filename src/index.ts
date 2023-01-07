/** API Request function */
export type APIRequest<Output = void, Input = void> = (input: Input) => Promise<Output>;
/** API Request Input extractor conditional type */
export type APIRequestInput<Request extends APIRequest<any, any>> =
  Request extends APIRequest<any, infer Input> ? Input : never;
/** API Request Output extractor conditional type */
export type APIRequestOutput<Request extends APIRequest<any, any>> =
  Request extends APIRequest<infer Output, any> ? Output : never;
/** A map of API requests */
export interface APIRequests {
  [key: string]: APIRequest<any, any>;
}

/** A mock implementation of an API request */
export type MockRequest<Request extends APIRequest<any, any>> = (
  input: APIRequestInput<Request>
) => APIRequestOutput<Request> | Promise<APIRequestOutput<Request>>;
/** A map of API request mocks */
export type APIMocks<API extends APIRequests> = {
  [Request in keyof API]: MockRequest<API[Request]>;
};

/** Base class for creating reusable API service objects */
export class APIService<API extends APIRequests> {
  /** API requests */
  requests: API = {} as API;
  /** API request mocks */
  mocks: APIMocks<API> = {} as APIMocks<API>;

  constructor(
    /** Name of the service. Used in integration mocking. Must be unique. */
    public name: string,
    /** Live implementation of the API requests */
    api: API,
    /** Additional configuration */
    config?: {
      /** Flag to enable integration testing mode. Will break the API for any other use. */
      integrationMocks?: boolean;
      /** Mocks for the API requests. Should be removed from production build. */
      mocks?: APIMocks<API>;
      /** Fake request delay in milliseconds when mocks are turned on.
       * @default 200
       */
      timeout?: number;
    }
  ) {
    if (config?.mocks) {
      this.mocks = config.mocks;
    }
    Object.keys(api).forEach((key: keyof API) => {
      const call = api[key];
      this.requests[key] = (async (input: APIRequestInput<typeof call>) => {
        if (config?.integrationMocks) {
          const response = await fetch(`/${this.name}/${key}`, {
            method: "POST",
            body: JSON.stringify(input),
            headers: {
              "Content-Type": "application/json",
            },
          });
          return await response.json();
        } else if (this.mocks[key]) {
          return new Promise<APIRequestOutput<typeof call>>((resolve) => {
            setTimeout(
              () => resolve(Promise.resolve(this.mocks[key](input))),
              config?.timeout || 200
            );
          });
        }
        return call(input);
      }) as API[keyof API];
    });
  }
}
/** Conditional type to extract the API requests map from the service */
export type ServiceAPI<Service extends APIService<any>> =
  Service extends APIService<infer API> ? API : never;

/** List of possible request methods, taken from pact-js */
export type HTTPMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "COPY"
  | "LOCK"
  | "MKCOL"
  | "MOVE"
  | "PROPFIND"
  | "PROPPATCH"
  | "UNLOCK"
  | "REPORT";

/** Request metadata to construct a MetaAPIRequest based on the input values */
export type RequestMetadata<Input> = {
  method: (input: Input) => HTTPMethod;
  path: (input: Input) => string;
  query: (input: Input) => { [name: string]: string };
  headers: (input: Input) => { [name: string]: string };
  body: (input: Input) => any;
};
/** API request with additional metadata used in contract testing */
export type MetaAPIRequest<Output, Input> = APIRequest<Output, Input> &
  RequestMetadata<Input>;
/** A map of API requests with metadata */
export interface MetaAPIRequests {
  [key: string]: MetaAPIRequest<any, any>;
}

/** Function to build a MetaAPIRequest */
export const metaRequest = <Output, Input>(
  /** Live API implementation. Receives the result of the metadata functions being executed with the request input. */
  call: (inputs: {
    method: string;
    path: string;
    query: { [name: string]: string };
    headers: { [name: string]: string };
    body: any;
  }) => Promise<Output>,
  /** Metadata generation functions */
  inputs: {
    /** The method of the request or a function that returns the method */
    method: HTTPMethod | ((input: Input) => HTTPMethod);
    /** The path of the request or a function that returns the path.
     * A string can be provided with url segments marked with properties of the input object.
     * @example /users/:id
     */
    path: string | ((input: Input) => string);
    /** A function returning the map of query parameters */
    query?: (input: Input) => { [name: string]: string };
    /** A function returning the map of request headers */
    headers?: (input: Input) => { [name: string]: string };
    /** A function returning the body */
    body?: (input: Input) => any;
  }
): MetaAPIRequest<Output, Input> => {
  const method =
    typeof inputs.method === "string"
      ? () => inputs.method as HTTPMethod
      : inputs.method;
  const path =
    typeof inputs.path === "string" ? buildURL(inputs.path) : inputs.path;
  const query = inputs.query || (() => ({}));
  const headers = inputs.headers || (() => ({}));
  const body = inputs.body || (() => {});
  const request: MetaAPIRequest<Output, Input> = (input: Input) =>
    call({
      method: method(input),
      path: path(input),
      query: query(input),
      headers: headers(input),
      body: body(input),
    });
  request.method = method;
  request.path = path;
  request.query = query;
  request.headers = headers;
  request.body = body;
  return request;
};

/** Utility function to replace url segments with values of the matching field names from the input object. */
export const buildURL = (url: string) => (input: { [key: string]: any }) =>
  input
    ? Object.keys(input).reduce(
        (res, key) => res.replace(`/:${key}/`, `/${input[key]}/`),
        url
      )
    : url;

/** Utility function to return a partial object of the input with only fields that are in the list. */
export const filterFields =
  (fields: string[]) =>
  <T>(input: T) =>
    Object.keys(input || {}).reduce((res, key: any) => {
      if (fields.includes(key.toString())) {
        return {
          ...res,
          [key]: res[key as keyof T],
        };
      }
      return res;
    }, {} as T);

/** Utility function to return a partial object of the input without fields that are in the list. */
export const weedOutFields =
  (fields: string[]) =>
  <T>(input: T) =>
    Object.keys(input || {}).reduce((res, key: any) => {
      if (fields.includes(key.toString())) {
        return res;
      }
      return {
        ...res,
        [key]: res[key as keyof T],
      };
    }, {} as T);

/** Extension of the APIService class for creating api objects with metadata for contract testing */
export class MetaAPIService<
  API extends MetaAPIRequests
> extends APIService<API> {
  /** Metadata from each of the requests */
  public meta: {
    [Request in keyof API]: RequestMetadata<APIRequestInput<API[Request]>>;
  };

  constructor(
    /** Name of the service. Used in integration mocking. Must be unique. */
    name: string,
    /** Live implementation of the API requests and their metadata */
    api: API,
    config?: {
      /** Flag to enable integration testing mode. Will break the API for any other use. */
      integrationMocks?: boolean;
      /** Mocks for the API requests. Should be removed from production build. */
      mocks?: APIMocks<API>;
      /** Fake request delay in milliseconds when mocks are turned on.
       * @default 200
       */
      timeout?: number;
    }
  ) {
    super(name, api, config);
    this.meta = Object.keys(api).reduce(
      (meta, key: keyof API) => ({
        ...meta,
        [key]: { ...api[key] },
      }),
      {} as {
        [Request in keyof API]: RequestMetadata<APIRequestInput<API[Request]>>;
      }
    );
  }
}
