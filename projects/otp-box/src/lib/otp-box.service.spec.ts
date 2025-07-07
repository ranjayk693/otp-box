import { TestBed } from '@angular/core/testing';

import { OtpBoxService } from './otp-box.service';

describe('OtpBoxService', () => {
  let service: OtpBoxService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OtpBoxService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
