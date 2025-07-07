import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, EventEmitter, forwardRef, Input, Output, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { FormsModule, NG_VALUE_ACCESSOR, NG_VALIDATORS, ControlValueAccessor, Validator, AbstractControl, ValidationErrors } from '@angular/forms';

@Component({
  selector: 'lib-otp-box',
  imports: [CommonModule, FormsModule],
  templateUrl: './otp-box.component.html',
  styleUrl: './otp-box.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => OtpBoxComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => OtpBoxComponent),
      multi: true
    }
  ]
})
export class OtpBoxComponent implements ControlValueAccessor, Validator {
  @Input() length: number = 6;
  @Input() autoFocus: boolean = true;
  @Input() showClipboardDetection: boolean = true;
  @Input() required: boolean = false;
  @Input() showValidationErrors: boolean = true;
  @Output() otpComplete = new EventEmitter<string>();
  @Output() otpChange = new EventEmitter<string>();

  otp: string[] = [];
  otpArray: number[] = [];
  
  // Auto-fill state
  showAutoFillBanner = false;
  detectedOtpCode = '';
  clipboardChecked = false;
  lastCheckMessage = '';
  
  // Validation state
  touched = false;
  errors: ValidationErrors | null = null;
  
  private clipboardMonitorInterval: any;
  private lastClipboardContent = '';
  private dismissedOtps = new Set<string>();
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  private isBrowser: boolean;

  constructor(
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    // Initialize OTP array based on length
    this.otp = new Array(this.length).fill('');
    this.otpArray = new Array(this.length).fill(0);
    
    if (this.showClipboardDetection) {
      this.startClipboardMonitoring();
      this.checkForClipboardOtp();
    }

    // Auto-focus first input if enabled
    if (this.autoFocus) {
      setTimeout(() => this.focusField(0), 100);
    }
  }

  ngOnDestroy() {
    this.stopClipboardMonitoring();
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    if (value) {
      const digits = value.split('');
      for (let i = 0; i < this.length && i < digits.length; i++) {
        this.otp[i] = digits[i];
      }
    } else {
      this.otp = new Array(this.length).fill('');
    }
    this.cdr.detectChanges();
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    // Handle disabled state if needed
  }

  // Validator implementation
  validate(control: AbstractControl): ValidationErrors | null {
    const value = this.getOtpValue();
    this.errors = null;

    // Only validate if touched or if there's a value
    if (!this.touched && !value) {
      return null;
    }

    if (this.required && !value) {
      this.errors = { required: true };
    } else if (value && value.length > 0 && value.length < this.length) {
      this.errors = { incomplete: true, expectedLength: this.length, actualLength: value.length };
    } else if (value && !/^\d*$/.test(value)) {
      this.errors = { pattern: true, message: 'OTP must contain only digits' };
    }

    return this.errors;
  }

  // Mark as touched
  markAsTouched() {
    this.touched = true;
    this.onTouched();
  }

  // Handle input blur
  onInputBlur(index: number) {
    // Only mark as touched when user leaves the OTP input area
    // Check if focus is moving to another OTP input
    if (this.isBrowser) {
      setTimeout(() => {
        const activeElement = document.activeElement;
        const isStillInOtpInputs = activeElement && activeElement.id && activeElement.id.startsWith('otp-');
        
        if (!isStillInOtpInputs) {
          this.markAsTouched();
        }
      }, 100);
    }
  }

  // Public method to trigger validation
  triggerValidation() {
    this.markAsTouched();
    this.validate({ value: this.getOtpValue() } as AbstractControl);
    this.cdr.detectChanges();
  }

  // Check if OTP is valid
  isValid(): boolean {
    return this.errors === null && this.isOtpFilled();
  }

  // Check if should show error state
  shouldShowError(): boolean {
    return !!(this.touched && this.errors && this.showValidationErrors);
  }

  // Check if should show individual input error
  shouldShowInputError(): boolean {
    // Only show error on individual inputs for pattern errors or if completely empty when required
    return this.shouldShowError() && (this.errors!['pattern'] || (this.errors!['required'] && this.isOtpEmpty()));
  }

  // Main clipboard checking method
  async checkForClipboardOtp() {
    if (!this.showClipboardDetection) return;
    
    try {
      const clipboardText = await navigator.clipboard.readText();
      this.clipboardChecked = true;
      
      if (clipboardText !== this.lastClipboardContent) {
        this.lastClipboardContent = clipboardText;
        await this.processClipboardContent(clipboardText);
      }
    } catch (error) {
      this.handleClipboardError(error);
    }
  }

  // Process clipboard content for OTP patterns
  async processClipboardContent(text: string) {
    const otpPatterns = [
      { pattern: /\b\d{6}\b/, name: 'Simple 6-digit' },
      { pattern: /\b\d{3}\s+\d{3}\b/, name: 'Spaced format' },
      { pattern: /\b\d{3}-\d{3}\b/, name: 'Hyphenated format' },
      { pattern: /\b\d{2}\s+\d{2}\s+\d{2}\b/, name: 'Double-spaced format' },
      { pattern: /(?:otp|code|verification)[\s:]*(\d{6})/i, name: 'Labeled OTP' },
      { pattern: /(\d{6})(?:\s*(?:is\s+your|otp|code|verification))/i, name: 'Trailing label' }
    ];

    let foundOtp = '';
    let matchType = '';

    for (const { pattern, name } of otpPatterns) {
      const match = text.match(pattern);
      if (match) {
        const digits = match[1] || match[0];
        const cleanDigits = digits.replace(/\D/g, '');
        
        if (cleanDigits.length === this.length) {
          foundOtp = cleanDigits;
          matchType = name;
          break;
        }
      }
    }

    if (foundOtp && !this.dismissedOtps.has(foundOtp) && this.isOtpEmpty()) {
      this.showAutoFillOption(foundOtp, matchType);
    } else if (!foundOtp) {
      this.hideAutoFillOption();
      this.lastCheckMessage = `No ${this.length}-digit OTP found in clipboard`;
    } else if (!this.isOtpEmpty()) {
      this.lastCheckMessage = 'OTP fields already filled';
    }
    
    this.cdr.detectChanges();
  }

  // Show auto-fill option
  showAutoFillOption(otpCode: string, matchType: string) {
    this.detectedOtpCode = this.formatOtpDisplay(otpCode);
    this.showAutoFillBanner = true;
    this.lastCheckMessage = `Found ${matchType}: ${this.detectedOtpCode}`;
  }

  // Hide auto-fill option
  hideAutoFillOption() {
    this.showAutoFillBanner = false;
    this.detectedOtpCode = '';
  }

  // Auto-fill the OTP
  autoFillOtp() {
    const digits = this.detectedOtpCode.replace(/\D/g, '').split('');
    if (digits.length === this.length) {
      this.fillOtpFields(digits);
      this.hideAutoFillOption();
      this.lastCheckMessage = 'OTP auto-filled successfully!';
      
      setTimeout(() => {
        this.emitOtpComplete();
      }, 100);
    }
  }

  // Dismiss auto-fill option
  dismissAutoFill() {
    const rawOtp = this.detectedOtpCode.replace(/\D/g, '');
    this.dismissedOtps.add(rawOtp);
    this.hideAutoFillOption();
    this.lastCheckMessage = 'Auto-fill dismissed';
  }

  // Manual clipboard check
  async manualClipboardCheck() {
    this.lastCheckMessage = 'Checking clipboard...';
    this.cdr.detectChanges();
    
    // Clear dismissed OTPs when manually checking
    this.dismissedOtps.clear();
    
    // Force re-check by clearing last clipboard content
    this.lastClipboardContent = '';
    
    await this.checkForClipboardOtp();
    
    if (!this.showAutoFillBanner) {
      this.lastCheckMessage = 'No valid OTP found in clipboard';
    }
  }

  // Start monitoring clipboard
  startClipboardMonitoring() {
    if (this.isBrowser) {
      this.clipboardMonitorInterval = setInterval(async () => {
        if (document.hasFocus() && this.isOtpEmpty()) {
          await this.checkForClipboardOtp();
        }
      }, 2000);
    }
  }

  stopClipboardMonitoring() {
    if (this.clipboardMonitorInterval) {
      clearInterval(this.clipboardMonitorInterval);
    }
  }

  // Handle clipboard access errors
  handleClipboardError(error: any) {
    console.warn('Clipboard access failed:', error);
    this.clipboardChecked = true;
    this.lastCheckMessage = 'Clipboard access denied. Please paste manually.';
    this.hideAutoFillOption();
    this.cdr.detectChanges();
  }

  // Utility methods
  formatOtpDisplay(digits: string): string {
    return digits.substring(0, 3) + ' ' + digits.substring(3);
  }

  fillOtpFields(digits: string[]) {
    for (let i = 0; i < this.length && i < digits.length; i++) {
      this.otp[i] = digits[i];
    }
    this.focusField(this.length - 1);
    this.emitOtpChange();
  }

  focusField(index: number) {
    if (this.isBrowser) {
      setTimeout(() => {
        const input = document.getElementById(`otp-${index}`) as HTMLInputElement;
        input?.focus();
      }, 0);
    }
  }

  clearOtp() {
    this.otp = new Array(this.length).fill('');
    this.dismissedOtps.clear();
    this.lastCheckMessage = 'OTP cleared';
    this.touched = false;
    this.focusField(0);
    this.emitOtpChange();
    
    if (this.showClipboardDetection) {
      setTimeout(() => {
        this.checkForClipboardOtp();
      }, 100);
    }
  }

  isOtpEmpty(): boolean {
    return this.otp.every(digit => digit === '');
  }

  isOtpFilled(): boolean {
    return this.otp.every(digit => digit !== '' && digit.length === 1);
  }

  getOtpValue(): string {
    return this.otp.join('');
  }

  // Emit events
  emitOtpComplete() {
    const otpValue = this.getOtpValue();
    if (this.isOtpFilled()) {
      this.lastCheckMessage = `OTP entered: ${this.formatOtpDisplay(otpValue)}`;
      this.onChange(otpValue);
      this.otpComplete.emit(otpValue);
      this.validate({ value: otpValue } as AbstractControl);
    }
  }

  emitOtpChange() {
    const otpValue = this.getOtpValue();
    this.onChange(otpValue);
    this.otpChange.emit(otpValue);
    this.validate({ value: otpValue } as AbstractControl);
  }

  // Input handlers
  onOtpInput(event: any, index: number) {
    const input = event.target;
    const value = input.value;

    // Handle paste of multiple digits
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').split('');
      this.fillOtpFieldsFromIndex(digits, index);
      return;
    }

    // Move to next input if value is entered
    if (value.length === 1 && index < this.length - 1) {
      this.focusField(index + 1);
    }

    this.emitOtpChange();

    // Check if OTP is complete
    if (this.isOtpFilled()) {
      this.emitOtpComplete();
    }
  }

  fillOtpFieldsFromIndex(digits: string[], startIndex: number) {
    for (let i = 0; i < digits.length && (startIndex + i) < this.length; i++) {
      this.otp[startIndex + i] = digits[i];
    }
    
    const nextIndex = Math.min(startIndex + digits.length, this.length - 1);
    this.focusField(nextIndex);
    this.emitOtpChange();
    
    if (this.isOtpFilled()) {
      this.emitOtpComplete();
    }
  }

  onOtpKeyDown(event: KeyboardEvent, index: number) {
    const input = event.target as HTMLInputElement;
    
    // Handle backspace
    if (event.key === 'Backspace') {
      if (!input.value && index > 0) {
        event.preventDefault();
        if (this.isBrowser) {
          const prevInput = document.getElementById('otp-' + (index - 1)) as HTMLInputElement;
          if (prevInput) {
            prevInput.focus();
            this.otp[index - 1] = '';
            prevInput.value = '';
            this.emitOtpChange();
          }
        }
      }
    }
    
    // Handle arrow keys for navigation
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusField(index - 1);
    } else if (event.key === 'ArrowRight' && index < this.length - 1) {
      event.preventDefault();
      this.focusField(index + 1);
    }
    
    // Prevent non-numeric input
    if (!/^[0-9]$/.test(event.key) && !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }
  }

  onOtpPaste(event: ClipboardEvent, index: number) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text/plain');
    
    if (pastedData) {
      const numericData = pastedData.replace(/\D/g, '');
      const digits = numericData.split('');
      
      if (digits.length === this.length && index === 0) {
        this.fillOtpFields(digits);
      } else {
        this.fillOtpFieldsFromIndex(digits, index);
      }
    }
  }
}
