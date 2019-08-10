import { TestSuiteInfo } from "vscode-test-adapter-api";
import { SpecResponseToTestSuiteInfoMapper } from "../../core/test-explorer/spec-response-to-test-suite-info.mapper";
import { KarmaEvent } from "../../model/karma-event";
import { KarmaEventName } from "../../model/enums/karma-event-name.enum";
import { TestState } from "../../model/enums/test-state.enum";
import { Logger } from "../shared/logger";
import { EventEmitter } from "../shared/event-emitter";
import { commands } from "vscode";
import { TestResult } from "../../model/enums/test-status.enum";
import { ErrorCodes } from "../../model/enums/error-codes.enum";

export class KarmaEventListener {
  public isServerLoaded: boolean = false;
  public isTestRunning: boolean = false;
  public lastRunTests: string = "";
  public testStatus: TestResult | any;
  public runCompleteEvent: KarmaEvent | any;
  private savedSpecs: any[] = [];
  private server: any;
  private karmaBeingReloaded: boolean = false;
  // private projectRootPath: string = "";

  public constructor(private readonly logger: Logger, private readonly eventEmitter: EventEmitter) {}

  public listenTillKarmaReady(defaultSocketPort?: number): Promise<void> {
    return new Promise<void>(resolve => {
      this.karmaBeingReloaded = false;
      const app = require("express")();
      this.server = require("http").createServer(app);
      const io = require("socket.io")(this.server, { forceNew: true });
      io.set("heartbeat interval", 24 * 60 * 60 * 1000);
      io.set("heartbeat timeout", 24 * 60 * 60 * 1000);

      const port = defaultSocketPort !== 0 ? defaultSocketPort : 9999;

      io.on("connection", (socket: any) => {
        socket.on(KarmaEventName.BrowserConnected, () => {
          this.onBrowserConnected(resolve);
        });
        socket.on(KarmaEventName.BrowserError, (event: KarmaEvent) => {
          this.logger.info("browser_error " + event.results);
        });
        socket.on(KarmaEventName.BrowserStart, () => {
          this.savedSpecs = [];
        });
        socket.on(KarmaEventName.RunComplete, (event: KarmaEvent) => {
          // this.eventEmitter.emitTestsLoadedEvent(this.getLoadedTests(this.projectRootPath));
          this.runCompleteEvent = event;
        });
        socket.on(KarmaEventName.SpecComplete, (event: KarmaEvent) => {
          this.onSpecComplete(event);
        });

        socket.on("disconnect", (event: any) => {
          const isKarmaBeingClosedByChrome = event === ErrorCodes.TransportClose && !this.karmaBeingReloaded;

          // workaround: if the connection is closed by chrome, we just reload the test enviroment
          // TODO: fix chrome closing all socket connections.
          if (isKarmaBeingClosedByChrome) {
            commands.executeCommand("test-explorer.reload");
          }
        });
      });

      this.server.listen(port, () => {
        this.logger.info("Listening to AngularReporter events on port " + port);
      });
    });
  }

  public getLoadedTests(projectRootPath: string): TestSuiteInfo {
    // this.projectRootPath = projectRootPath;
    const specToTestSuiteMapper = new SpecResponseToTestSuiteInfoMapper(projectRootPath);
    return specToTestSuiteMapper.map(this.savedSpecs);
  }

  public stopListeningToKarma() {
    this.isServerLoaded = false;
    this.karmaBeingReloaded = true;
    this.server.close();
  }

  private onSpecComplete(event: KarmaEvent) {
    const { results } = event;

    const testName = results.fullName;

    if (testName === this.lastRunTests[0] || this.lastRunTests === "") {
      this.eventEmitter.emitTestStateEvent(results.id, TestState.Running);
      this.savedSpecs.push(results);

      this.eventEmitter.emitTestResultEvent(results.id, event);

      if (this.lastRunTests !== "") {
        this.testStatus = results.status;
      }
    }
  }

  private onBrowserConnected(resolve: (value?: void | PromiseLike<void>) => void) {
    resolve();
    this.isServerLoaded = true;
  }
}
