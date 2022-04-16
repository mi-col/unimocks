import { HTTPRequest, Page } from "puppeteer";
import {
  APIRequest,
  APIRequestInput,
  APIRequestOutput,
  MockRequest,
  APIService,
  ServiceAPI,
} from ".";

/** Mock implementation of an erroring out request */
export type MockError<Request extends APIRequest<any, any>, Error = any> = (
  input: APIRequestInput<Request>
) => Error | Promise<Error>;

/** A recorder API request */
export interface PuppetCall<Request extends APIRequest<any, any>, Error = any> {
  input: APIRequestInput<Request>;
  output: APIRequestOutput<Request> | Error;
}

/** An interceptor for an API request */
export interface PuppetMock<Request extends APIRequest<any, any>, Error = any> {
  /** History of inputs and outputs of all requests made */
  calls: PuppetCall<Request, Error>[];
  /** Details of the last request made */
  last: Promise<PuppetCall<Request, Error>>;
  /** Method to set a custom response */
  setResponse: (mock: MockRequest<Request>) => void;
  /** Method to set a custom error response */
  setError: (status: number, mock: MockError<Request, Error>) => void;
  /** Method to reset the custom response to the default mock */
  reset: VoidFunction;
}

/** A set of interceptors for all the requests of a service */
export type ServiceMock<Service extends APIService<any>, Error = any> = {
  [Request in keyof ServiceAPI<Service>]: PuppetMock<
    ServiceAPI<Service>[Request],
    Error
  >;
};

class RequestMock<Request extends APIRequest<any, any>, Error = any>
  implements PuppetMock<Request>
{
  private status = 200;

  private override?: MockRequest<Request> | MockError<Request, Error>;

  public calls: PuppetCall<Request, Error>[] = [];

  get last() {
    return this.page
      .waitForNetworkIdle()
      .then(() => this.calls[this.calls.length - 1]);
  }

  private listener = async (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) return;
    if (request.url().endsWith(this.url)) {
      const input: APIRequestInput<Request> = JSON.parse(
        request.postData() || "{}"
      );
      const output = await (this.override || this.baseMock)(input);
      if (request.isInterceptResolutionHandled()) {
        return;
      }
      this.calls.push({ input, output });
      request.respond(
        {
          status: this.status,
          contentType: "application/json",
          body: JSON.stringify(output),
        },
        0
      );
    } else {
      if (request.isInterceptResolutionHandled()) {
        return;
      }
      request.continue({}, -1);
    }
  };

  constructor(
    private page: Page,
    private url: string,
    private baseMock: MockRequest<Request>
  ) {
    page.on("request", this.listener);
  }

  setResponse = (mock: MockRequest<Request>) => {
    this.override = mock;
  };

  setError = (code: number, mock: MockError<Request, Error>) => {
    this.status = code;
    this.override = mock;
  };

  reset = () => {
    this.status = 200;
    this.override = undefined;
  };
}

/** A method to setup interceptors and mocks for an API service */
export const mockAPI = async <Service extends APIService<any>, Error = any>(
  api: Service,
  page: Page
): Promise<ServiceMock<Service, Error>> => {
  await page.setRequestInterception(true);
  return Object.keys(api.requests).reduce(
    (mocks, key: keyof ServiceAPI<Service>) => ({
      ...mocks,
      [key]: new RequestMock(
        page,
        `${api.name}/${key}`,
        api.mocks[key] || (() => ({}))
      ),
    }),
    {} as ServiceMock<Service, Error>
  );
};
