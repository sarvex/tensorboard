/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {CdkScrollable} from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Optional,
  Output,
  SimpleChanges,
} from '@angular/core';

import {PluginType} from '../../data_source';
import {CardObserver} from '../card_renderer/card_lazy_loader';

import {CardIdWithMetadata} from '../metrics_view_types';

const MIN_CARD_WIDTH = 335;
const MIN_CARD_MAX_WIDTH_IN_VW = 30;
const MAX_CARD_MAX_WIDTH_IN_VW = 100;

@Component({
  selector: 'metrics-card-grid-component',
  templateUrl: './card_grid_component.ng.html',
  styleUrls: ['./card_grid_component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardGridComponent {
  readonly PluginType = PluginType;
  gridTemplateColumn = '';

  @Input() isGroupExpanded!: boolean;
  @Input() pageIndex!: number;
  @Input() numPages!: number;
  @Input() cardIdsWithMetadata!: CardIdWithMetadata[];
  @Input() cardMaxWidthInVW!: number | null;
  @Input() cardObserver!: CardObserver;
  @Input() showPaginationControls!: boolean;

  @Output() pageIndexChanged = new EventEmitter<number>();

  constructor(
    @Optional() private readonly cdkScrollable: CdkScrollable | null
  ) {}

  ngOnInit() {
    if (this.isCardWidthValid(this.cardMaxWidthInVW)) {
      this.gridTemplateColumn = `repeat(auto-fill, minmax(${MIN_CARD_WIDTH}px, ${this.cardMaxWidthInVW}vw))`;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cardMaxWidthInVW']) {
      const newCardWidth = changes['cardMaxWidthInVW'].currentValue;
      if (this.isCardWidthValid(newCardWidth)) {
        this.cardMaxWidthInVW = newCardWidth;
        this.gridTemplateColumn = `repeat(auto-fill, minmax(${MIN_CARD_WIDTH}px, ${this.cardMaxWidthInVW}vw))`;
      } else {
        this.gridTemplateColumn = '';
      }
    }
  }

  isCardWidthValid(cardMaxWidthInVW: number | null) {
    return (
      cardMaxWidthInVW &&
      cardMaxWidthInVW >= MIN_CARD_MAX_WIDTH_IN_VW &&
      cardMaxWidthInVW <= MAX_CARD_MAX_WIDTH_IN_VW
    );
  }

  showPaginationInput(isBottomControl: boolean) {
    return isBottomControl;
  }

  handlePageChange(pageIndex: number, target: HTMLElement) {
    // Clear call stack to allow dom update before updating scroll to keep
    // relative position.
    const topBeforeChange = target.getBoundingClientRect().top;
    setTimeout(() => {
      this.scrollToKeepTargetPosition(target, topBeforeChange);
    }, 0);

    this.pageIndexChanged.emit(pageIndex);
  }

  scrollToKeepTargetPosition(target: HTMLElement, previousTop: number) {
    const scrollingElement = this.cdkScrollable?.getElementRef().nativeElement;
    if (scrollingElement) {
      scrollingElement.scrollTo(
        0,
        target.getBoundingClientRect().top -
          previousTop +
          scrollingElement.scrollTop
      );
    }
  }

  trackByCards(index: number, cardIdWithMetadata: CardIdWithMetadata) {
    return cardIdWithMetadata.cardId;
  }

  onPaginationInputChange(event: Event) {
    const input = event.target as HTMLInputElement;

    if (event.type === 'input' && input.value === '') {
      return;
    }

    const currentValue = Number(input.value) - 1;
    const nextValue = Math.min(Math.max(0, currentValue), this.numPages - 1);

    // Rectifying logic is at the container but the rectified value does not
    // appropriately make changes to the `<input>`.
    // Speculation: Angular seems to have some check on the template level that
    // does shallow equals and prevent changing on the same value.
    // Evidence: pageIndex change does fire, but `ngOnChanges` does not get
    // triggered when the value is the same (rectified value).
    if (input.value !== String(nextValue + 1)) {
      input.value = String(nextValue + 1);
    }

    this.handlePageChange(nextValue, input);
  }
}
